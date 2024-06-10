const fs = require('fs');
const path = require('path');
const http = require("http");
const express = require('express');
const { createClient, LiveTranscriptionEvents } = require("@deepgram/sdk");
const dotenv = require("dotenv");
dotenv.config();
const { Server } = require("socket.io");


const app = express();
const server = http.createServer(app);
const io = new Server(server);

const deepgramClient = createClient(process.env.DEEPGRAM_API_KEY);
const deepgramInstances = {};

const setupDeepgram = (socket) => {
  console.log("Setting up deepgram connection for socket " + socket.id);
  const deepgram = deepgramClient.listen.live({
    language: "en",
    model: "nova-2",
    keywords: "yap:5000"
  });

  deepgram.addListener(LiveTranscriptionEvents.Open, async () => {
    console.log("deepgram: connected");
  });

  deepgram.addListener(LiveTranscriptionEvents.Transcript, (data) => {
    let res = JSON.stringify(data);
    console.log(res);
    console.log("socket: transcript sent to client");
    socket.emit('transcript', res);
  });

  deepgram.addListener(LiveTranscriptionEvents.Close, async () => {
    console.log("deepgram: received close event");
    // clearInterval(keepAlive);
  });

  deepgram.addListener(LiveTranscriptionEvents.Error, async (error) => {
    console.error(error);
  });

  deepgram.addListener(LiveTranscriptionEvents.Warning, async (warning) => {
    console.warn(warning);
  });

  deepgramInstances[socket.id] = deepgram;
  return deepgram;
};

function deepgramCleanup(socketId){
  try {
    const deepgram = deepgramInstances[socketId];
    if (deepgram) {
      deepgram.finish();
      deepgram.removeAllListeners();
      console.log('Deepgram connection finished and cleaned up for socket ' + socketId);
    }
  } catch (error) {
    console.error(error);
  }
};

function deepgramRemoval(socketId){
  deepgramCleanup(socketId);
  delete deepgramInstances[socketId];
};

function sendScores(socket) {
  fs.readFile('scores.json', (err, data) => {
    if (err) {
      console.error("Failed to read scores file:", err);
      return;
    }
    console.log('Read scores.json')
    try {
      let scores = JSON.parse(data);
      scores.sort((a, b) => b.score - a.score);
      socket.emit('setLeaderboard', scores);
      console.log('Sent current leaderboard scores to client')
    } catch (parseError) {
      console.error("Failed to parse scores JSON:", parseError);
    }
  });
}

io.on("connection", (socket) => {
  console.log("socket: client connected");
  deepgram = setupDeepgram(socket);
  sendScores(socket);

  socket.on("audioMessage", (message) => {
    const deepgram = deepgramInstances[socket.id];
    if (deepgram.getReadyState() === 1 /* OPEN */) {
      deepgram.send(message);
    } else {
      console.log('socket ' + socket.id + ": data couldn't be sent to deepgram, state:", deepgram.getReadyState());
    }
  });

  socket.on("saveLeaderboard", (updatedLeaderboard) => {
    fs.writeFile('scores.json', JSON.stringify(updatedLeaderboard, null, 2), (err) => {
      if (err) {
        console.error("Failed to update scores file:", err);
        return;
      }
      console.log('socket ' + socket.id + ': Leaderboard updated');
    
    });
  });

  socket.on("disconnect", () => {
    console.log('socket ' + socket.id + ': Client disconnected');
    deepgramRemoval(socket.id);
  });

  socket.on("dg-disconnect", () => {
    console.log('socket ' + socket.id + ': dg-disconnect');
    deepgramCleanup(socket.id);
  });

  socket.on("dg-connect", () => {
    console.log('socket ' + socket.id + ': dg-connect');
    sendScores(socket);
    deepgram = setupDeepgram(socket);
  })
});

app.use(express.static(path.join(__dirname, 'public')));

server.listen(8000, () => {
  console.log("Server is listening on port 8000");
});