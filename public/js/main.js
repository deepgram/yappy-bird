/*
   Copyright 2014 Nebez Briefkani
   floppybird - main.js

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/

import { io } from "https://cdn.socket.io/4.7.4/socket.io.esm.min.js";
export const socket = io(WS_URL);

let debugmode = false;

let states = Object.freeze({
  SplashScreen: 0,
  GameScreen: 1,
  ScoreScreen: 2
});

let currentstate;

// Original gravity value
const originalGravity = 0.2;
let gravity = originalGravity;

let velocity = 0;
let position = 180;
let rotation = 0;
let jump = -4.1;
let flyArea = $("#flyarea").height();

let score = 0;
let highscore = 0;

let pipeheight = 160; //90;
let pipewidth = 52;
let pipes = new Array();

let replayclickable = false;

//sounds
let volume = 30;
let soundJump = new buzz.sound("assets/sounds/sfx_wing.ogg");
let soundScore = new buzz.sound("assets/sounds/sfx_point.ogg");
let soundHit = new buzz.sound("assets/sounds/sfx_hit.ogg");
let soundDie = new buzz.sound("assets/sounds/sfx_die.ogg");
let soundSwoosh = new buzz.sound("assets/sounds/sfx_swooshing.ogg");
buzz.all().setVolume(volume);

//loops
let loopGameloop;
let loopPipeloop;

// Added for Yappy mechanics
let microphone = undefined;
let startTime = null;

let glideTimeoutId = null;
let isGlideAllowed = true; // Flag to prevent glide interruption
let defaultGlideDuration = 1000
const flapWords = ['up', 'yap', 'yep', 'flap']
const startWords = ['start', 'yap down for what']
let leaderboard;

//start simple sound flap listening
window.addEventListener('load', function () {
  navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    .then(function (stream) {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      const microphone = audioContext.createMediaStreamSource(stream);
      microphone.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const checkSound = function () {
        analyser.getByteFrequencyData(dataArray);
        let sum = dataArray.reduce((a, b) => a + b, 0);
        let average = sum / dataArray.length;
        // Simple threshold check with debounce
        if (average > 20 && isGlideAllowed && currentstate !== states.SplashScreen) {
          startGlide();
        }
        requestAnimationFrame(checkSound);
      };
      checkSound();
    })
    .catch(function (err) {
      console.log('Error: ' + err);
    });
});

socket.on("transcript", (data) => {
  const res = JSON.parse(data);
  if (res.type.toLowerCase() === 'results') {
    let transcript = res.channel.alternatives[0].transcript
    let resEnd = res.start + res.duration
    let audioCursor = performance.now() - startTime;
    let transcriptCursor = resEnd * 1000;
    let sttLatency = audioCursor - transcriptCursor;
    console.log(`sttLatency: ${sttLatency}, start: ${res.start}, end: ${resEnd}, transcript: ${transcript}`)


    let wordsArr = res.channel.alternatives[0].words;

    if (currentstate == states.SplashScreen) {
      handleWordDetection(transcript, startWords, startGame);
    } else if (currentstate == states.GameScreen) {
      // Use the new function for GameScreen state with detailed logic
      handleWordDetection(transcript, flapWords, () => {
        let flapWordDetected = wordsArr.filter(wordObj => flapWords.includes(wordObj.word.toLowerCase()));
        if (flapWordDetected.length > 0) {
          let flapCount = flapWordDetected.length;
          playerJump(flapCount);
          flapWordDetected.forEach(wordObj => {
            let audioCursor = performance.now() - startTime;
            let transcriptCursor = wordObj.end * 1000;
            let wordLatency = audioCursor - transcriptCursor
            console.log(`Flap detect latency for '${wordObj.word}': ${wordLatency} ms`);
          });
        }
      });
    }
  } else {
    console.log(res);
  }
});

socket.on("setLeaderboard", (leaderboardData) => {
  console.log('Received current leaderboard from server')
  updateLeaderboard(leaderboardData);
});

function updateLeaderboard(leaderboardData) {
  leaderboard = leaderboardData;
  console.log('Updating leaderboard')
  const topTen = leaderboard.slice(0, 10)
  
  const topFivePlayers = $("#top-five-players");
  const bottomFivePlayers = $("#bottom-five-players");

  topFivePlayers.empty();
  bottomFivePlayers.empty();

  topTen.forEach((entry, index) => {
    const rank = index + 1;
    let displayName = entry.name;
    if (entry.name.includes(' ')) {
      const words = entry.name.split(' ');
      if (words[0].length > 14) {
        // If the first word itself is more than 14 characters, use initials for all words
        displayName = words.map(word => word[0].toUpperCase() + '.').join(' ');
      } else {
        // Construct displayName with the first word and initials of subsequent words
        displayName = words[0];
        words.slice(1).forEach(word => {
          displayName += ` ${word[0].toUpperCase()}`;
        });
        // If the constructed displayName exceeds 14 characters, use only initials
        if (displayName.length > 14) {
          displayName = words.map(word => word[0].toUpperCase() + '.').join(' ');
        }
      }
    } else if (displayName.length > 14) {
      displayName = displayName.substring(0, 11) + '...';
    }

    const entryHtml = `
      <div class="player-entry" id="player${rank}">
        <div class="player-name" id="playername${rank}">${displayName}</div>
        <div class="player-score" id="playerscore${rank}">${entry.score}</div>
      </div>`;

    if (index < 5) {
      topFivePlayers.append(entryHtml);
    } else {
      bottomFivePlayers.append(entryHtml);
    }
  });
};

// Function to adjust gravity for wind-up mechanic
function adjustGravityByRatio(ratio) {
  gravity = gravity * ratio;
}

// Reset gravity to original value
function resetGravity() {
  gravity = originalGravity;
}

// Function to start a glide
function startGlide(glideDuration = defaultGlideDuration) {
  adjustGravityByRatio(0); // Set gravity to 0 or a very low value for horizontal glide
  velocity = -0.2;
  $("#player").addClass("bird-glow"); // Add glow effect
  isGlideAllowed = false;
  glideTimeoutId = setTimeout(() => {
    endGlide();
  }, glideDuration); // Duration of the glide
}

// Function to end the glide
function endGlide() {
  $("#player").removeClass("bird-glow"); // Remove glow effect
  resetGravity(); // Reset gravity to its original value
  velocity = originalGravity;
  glideTimeoutId = null;
  setTimeout(() => {
    isGlideAllowed = true;
  }, 300);

}

async function getMicrophone() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return new MediaRecorder(stream, { mimeType: "audio/webm" });
  } catch (error) {
    console.error("Error accessing microphone:", error);
    throw error;
  }
}

async function openMicrophone(microphone) {
  return new Promise((resolve) => {
    microphone.onstart = () => {
      console.log("Mic started");
      startTime = performance.now();
      resolve();
    };

    microphone.onstop = () => {
      console.log("Mic stopped");
    };

    microphone.ondataavailable = (event) => {
      if (event.data.size > 0) {
        socket.emit('audioMessage', event.data);
      }
    };
    microphone.start(200);
  });
}


async function closeMicrophone(microphone) {
  microphone.stop();
}

function handleWordDetection(transcript, triggerWordsArr, callback) {
  let wordDetected = triggerWordsArr.filter(word => transcript.toLowerCase().includes(word));
  if (wordDetected.length > 0) {
    callback();
  }
}

async function openMicrophoneOnGameStart() {
  console.log("Preparing to start the game...");
  try {
    microphone = await getMicrophone();
    await openMicrophone(microphone);
  } catch (error) {
    console.error("Error opening microphone:", error);
  }
}

/// Game code
$(document).ready(function () {
  if (window.location.search == "?debug")
    debugmode = true;
  if (window.location.search == "?easy")
    pipeheight = 200;

  //get the highscore
  let savedscore = getCookie("highscore");
  if (savedscore != "")
    highscore = parseInt(savedscore);

  // DOM element event headers
  $("#submit-name").click(handleScoreSubmission);
  $("#replay").click(function () {
    //make sure we can only click once
    if (!replayclickable)
      return;
    else
      replayclickable = false;
    //SWOOSH!
    soundSwoosh.stop();
    soundSwoosh.play();

    //fade out the scoreboard and leaderboard
    $("#leaderboard").transition({ y: '40px', opacity: 0 }, 1000, 'ease', () => {
      $("#leaderboard").css("display", "none");
    });

    $("#scoreboard").transition({ y: '-40px', opacity: 0 }, 1000, 'ease', function () {
      //when that's done, display us back to nothing
      $("#scoreboard").css("display", "none");

      //start the game over!
      socket.emit("dg-connect")
      showSplash();
    });
  });

  //start with the splash screen
  showSplash();
});

function getCookie(cname) {
  let name = cname + "=";
  let ca = document.cookie.split(';');
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i].trim();
    if (c.indexOf(name) == 0) return c.substring(name.length, c.length);
  }
  return "";
}

function setCookie(cname, cvalue, exdays) {
  let d = new Date();
  d.setTime(d.getTime() + (exdays * 24 * 60 * 60 * 1000));
  let expires = "expires=" + d.toGMTString();
  document.cookie = cname + "=" + cvalue + "; " + expires;
}

function showSplash() {
  currentstate = states.SplashScreen;
  $("#name-input").hide();

  //set the defaults (again)
  velocity = 0;
  position = 180;
  rotation = 0;
  score = 0;

  //update the player in preparation for the next game
  $("#player").css({ y: 0, x: 0 });
  updatePlayer($("#player"));

  soundSwoosh.stop();
  // soundSwoosh.play();

  //clear out all the pipes if there are any
  $(".pipe").remove();
  pipes = new Array();

  //make everything animated again
  $(".animated").css('animation-play-state', 'running');
  $(".animated").css('-webkit-animation-play-state', 'running');

  //fade in the splash and leaderboard
  $("#splash").css("display", "block");
  $("#splash").transition({ opacity: 1 }, 2000, 'ease');

  $("#leaderboard").css("display", "block");
  $("#leaderboard").css({ y: '-40px', opacity: 0 });
  $("#leaderboard").transition({ y: '0px', opacity: 1 }, 600, 'ease')


  openMicrophoneOnGameStart();
}

function startGame() {
  currentstate = states.GameScreen;

  //fade out the splash and leaderboard
  $("#splash").fadeOut(300, function () {
    $("#leaderboard").fadeOut(200, function () {
      $("#leaderboard").css("display", "none");
    });
  });


  //update the big score
  setBigScore();

  //debug mode?
  if (debugmode) {
    //show the bounding boxes
    $(".boundingbox").show();
  }

  //start up our loops
  let updaterate = 1000.0 / 60.0; //60 times a second
  loopGameloop = setInterval(gameloop, updaterate);
  loopPipeloop = setInterval(updatePipes, 1400);

  //jump and glide from the start!
  playerJump();
  startGlide(2500);

}

function updatePlayer(player) {
  //rotation
  rotation = Math.min((velocity / 10) * 90, 90);

  //apply rotation and position
  $(player).css({ rotate: rotation, top: position });
}

function gameloop() {
  let player = $("#player");

  //update the player speed/position
  // velocity += gravity;
  // position += velocity;

  // velocity += 0.01;
  // position += velocity;

  if (velocity < 0) {
    velocity += gravity;
  } else {
    velocity += 0.02;
  }

  position += velocity;

  //update the player
  updatePlayer(player);

  //create the bounding box
  let box = document.getElementById('player').getBoundingClientRect();
  let origwidth = 34.0;
  let origheight = 24.0;

  let boxwidth = origwidth - (Math.sin(Math.abs(rotation) / 90) * 8);
  let boxheight = (origheight + box.height) / 2;
  let boxleft = ((box.width - boxwidth) / 2) + box.left;
  let boxtop = ((box.height - boxheight) / 2) + box.top;
  let boxright = boxleft + boxwidth;
  let boxbottom = boxtop + boxheight;

  //if we're in debug mode, draw the bounding box
  if (debugmode) {
    let boundingbox = $("#playerbox");
    boundingbox.css('left', boxleft);
    boundingbox.css('top', boxtop);
    boundingbox.css('height', boxheight);
    boundingbox.css('width', boxwidth);
  }

  //did we hit the ground?
  if (box.bottom >= $("#land").offset().top) {
    playerDead();
    return;
  }

  //have they tried to escape through the ceiling? :o
  let ceiling = $("#ceiling");
  if (boxtop <= (ceiling.offset().top + ceiling.height()))
    position = 0;

  //we can't go any further without a pipe
  if (pipes[0] == null)
    return;

  //determine the bounding box of the next pipes inner area
  let nextpipe = pipes[0];
  let nextpipeupper = nextpipe.children(".pipe_upper");

  let pipetop = nextpipeupper.offset().top + nextpipeupper.height();
  let pipeleft = nextpipeupper.offset().left - 2; // for some reason it starts at the inner pipes offset, not the outer pipes.
  let piperight = pipeleft + pipewidth;
  let pipebottom = pipetop + pipeheight;

  if (debugmode) {
    let boundingbox = $("#pipebox");
    boundingbox.css('left', pipeleft);
    boundingbox.css('top', pipetop);
    boundingbox.css('height', pipeheight);
    boundingbox.css('width', pipewidth);
  }

  //have we gotten inside the pipe yet?
  if (boxright > pipeleft) {
    //we're within the pipe, have we passed between upper and lower pipes?
    if (boxtop > pipetop && boxbottom < pipebottom) {
      //yeah! we're within bounds

    }
    else {
      //no! we touched the pipe
      playerDead();
      return;
    }
  }


  //have we passed the imminent danger?
  if (boxleft > piperight) {
    //yes, remove it
    pipes.splice(0, 1);

    //and score a point
    playerScore();
  }
}

//Handle space bar
$(document).keydown(function (e) {
  //space bar!
  if (e.keyCode == 32) {
    //in ScoreScreen, hitting space should click the "replay" button. else it's just a regular spacebar hit
    if (currentstate == states.ScoreScreen)
      $("#replay").click();
    else
      screenClick();
  }
});

// Allow name input modal for leaderboard to be closed with esc key
$(document).keydown(function (e) {
  if (e.keyCode == 27) {
    // Check if the #name-input modal is visible
    if ($("#name-input").is(":visible")) {
      $("#name-input").hide();
      replayclickable = true;
    }
  }
});

// Allow enter key to submit name for leaderboard
$("#player-name").keydown(function (e) {
  if (e.keyCode == 13) {
    e.preventDefault();
    $("#submit-name").click();
  }
});

//Handle mouse down OR touch start
if ("ontouchstart" in window)
  $(document).on("touchstart", screenClick);
else
  $(document).on("mousedown", screenClick);

function screenClick() {
  if (currentstate == states.GameScreen) {
    playerJump();
  }
  else if (currentstate == states.SplashScreen) {
    startGame();
  }
}

function playerJump(multiplier = 1) {
  // Apply a logarithmic function to the multiplier to achieve a diminishing effect
  // Ensure that the multiplier is at least 1 to avoid logarithm of 0
  if (glideTimeoutId !== null) {
    clearTimeout(glideTimeoutId);
    endGlide();
  }
  isGlideAllowed = false;
  const adjustedMultiplier = Math.log(multiplier + 2);

  // console.log(`Jump multiplier (adj): ${adjustedMultiplier}`)

  // You might still want to cap the maximum effect to prevent excessive jump strength
  const maxEffect = 3; // This is the maximum effect the multiplier can have
  const effectiveMultiplier = Math.min(adjustedMultiplier, maxEffect);

  velocity = jump * effectiveMultiplier;

  console.log(`Flap word detected ${multiplier} time(s), jump adj multiplier ${adjustedMultiplier}, jump strength ${jump * effectiveMultiplier} !`);

  //play jump sound
  soundJump.stop();
  soundJump.play();

  setTimeout(() => {
    isGlideAllowed = true;
  }, 300);
}

function setBigScore(erase) {
  let elemscore = $("#bigscore");
  elemscore.empty();

  if (erase)
    return;

  let digits = score.toString().split('');
  for (let i = 0; i < digits.length; i++)
    elemscore.append("<img src='assets/font_big_" + digits[i] + ".png' alt='" + digits[i] + "'>");
}

function setSmallScore() {
  let elemscore = $("#currentscore");
  elemscore.empty();

  let digits = score.toString().split('');
  for (let i = 0; i < digits.length; i++)
    elemscore.append("<img src='assets/font_small_" + digits[i] + ".png' alt='" + digits[i] + "'>");
}

function setHighScore() {
  let elemscore = $("#highscore");
  elemscore.empty();

  let digits = highscore.toString().split('');
  for (let i = 0; i < digits.length; i++)
    elemscore.append("<img src='assets/font_small_" + digits[i] + ".png' alt='" + digits[i] + "'>");
}

function setMedal() {
  let medal;
  let elemmedal = $("#medal");
  elemmedal.empty();

  if (score < 10)
    //signal that no medal has been won
    return false;

  if (score >= 10)
    medal = "bronze";
  if (score >= 20)
    medal = "silver";
  if (score >= 30)
    medal = "gold";
  if (score >= 40)
    medal = "platinum";

  elemmedal.append('<img src="assets/medal_' + medal + '.png" alt="' + medal + '">');

  //signal that a medal has been won
  return true;
}

function handleScoreSubmission() {
  const playerName = $("#player-name").val();

  // Assuming 'score' and 'leaderboard' are accessible here
  const newScoreEntry = { name: playerName, score: score };

  leaderboard.push(newScoreEntry);
  leaderboard.sort((a, b) => b.score - a.score);

  updateLeaderboard(leaderboard);

  socket.emit('saveLeaderboard', leaderboard);

  $("#name-input").hide();
  replayclickable = true;
}

function playerDead() {
  //stop animating everything!
  $(".animated").css('animation-play-state', 'paused');
  $(".animated").css('-webkit-animation-play-state', 'paused');

  //drop the bird to the floor
  let playerbottom = $("#player").position().top + $("#player").width(); //we use width because he'll be rotated 90 deg
  let floor = flyArea;
  let movey = Math.max(0, floor - playerbottom);
  $("#player").transition({ y: movey + 'px', rotate: 90 }, 1000, 'easeInOutCubic');

  //it's time to change states. as of now we're considered ScoreScreen to disable left click/flying
  currentstate = states.ScoreScreen;

  //destroy our gameloops
  clearInterval(loopGameloop);
  clearInterval(loopPipeloop);
  loopGameloop = null;
  loopPipeloop = null;

  //mobile browsers don't support buzz bindOnce event
  if (isIncompatible.any()) {
    //skip right to showing score
    showScore();
  }
  else {
    //play the hit sound (then the dead sound) and then show score
    soundHit.play().bindOnce("ended", function () {
      soundDie.play().bindOnce("ended", function () {
        showScore();
      });
    });
  }

  // Close the microphone when the player hits the ground
  if (microphone) {
    closeMicrophone(microphone).then(() => {
      console.log("Bird down. Microphone closed.");
      microphone = undefined;
    }).catch((error) => {
      console.error("Error closing microphone:", error);
    });
  }
  socket.emit('dg-disconnect')

  // Capture all scores above 0 even if not in top ten
  if (score > 0) {
    $("#player-name").val('');
    replayclickable = false;
    setTimeout(() => {
      $("#name-input").show();
    }, 2000);
  } else {
    replayclickable = true;
  }
}

function showScore() {
  //unhide score and leaderboard
  $("#scoreboard").css("display", "block");
  $("#leaderboard").css("display", "block");

  //remove the big score
  setBigScore(true);

  //have they beaten their high score?
  if (score > highscore) {
    //yeah!
    highscore = score;
    //save it!
    setCookie("highscore", highscore, 999);
  }

  //update the scoreboard
  setSmallScore();
  setHighScore();
  let wonmedal = setMedal();

  //SWOOSH!
  soundSwoosh.stop();
  soundSwoosh.play();


  //show the scoreboard and leaderboard
  $("#scoreboard").css({ y: '40px', opacity: 0 }); //move it down so we can slide it up
  $("#leaderboard").css({ y: '-40px', opacity: 0 });  // vice versa
  $("#replay").css({ y: '40px', opacity: 0 });
  $("#leaderboard").transition({ y: '0px', opacity: 1 }, 600, 'ease')
  $("#scoreboard").transition({ y: '0px', opacity: 1 }, 600, 'ease', function () {
    //When the animation is done, animate in the replay button and SWOOSH!
    soundSwoosh.stop();
    soundSwoosh.play();
    $("#replay").transition({ y: '0px', opacity: 1 }, 600, 'ease');

    //also animate in the MEDAL! WOO!
    if (wonmedal) {
      $("#medal").css({ scale: 2, opacity: 0 });
      $("#medal").transition({ opacity: 1, scale: 1 }, 1200, 'ease');
    }
  });

  //make the replay button clickable
  // replayclickable = true;
}

function playerScore() {
  score += 1;
  //play score sound
  soundScore.stop();
  soundScore.play();
  setBigScore();
}

function updatePipes() {
  //Do any pipes need removal?
  $(".pipe").filter(function () { return $(this).position().left <= -100; }).remove()

  //add a new pipe (top height + bottom height  + pipeheight == flyArea) and put it in our tracker
  let padding = 80;
  let constraint = flyArea - pipeheight - (padding * 2); //double padding (for top and bottom)
  let topheight = Math.floor((Math.random() * constraint) + padding); //add lower padding
  let bottomheight = (flyArea - pipeheight) - topheight;
  let newpipe = $('<div class="pipe animated"><div class="pipe_upper" style="height: ' + topheight + 'px;"></div><div class="pipe_lower" style="height: ' + bottomheight + 'px;"></div></div>');
  $("#flyarea").append(newpipe);
  pipes.push(newpipe);
}

let isIncompatible = {
  Android: function () {
    return navigator.userAgent.match(/Android/i);
  },
  BlackBerry: function () {
    return navigator.userAgent.match(/BlackBerry/i);
  },
  iOS: function () {
    return navigator.userAgent.match(/iPhone|iPad|iPod/i);
  },
  Opera: function () {
    return navigator.userAgent.match(/Opera Mini/i);
  },
  Safari: function () {
    return (navigator.userAgent.match(/OS X.*Safari/) && !navigator.userAgent.match(/Chrome/));
  },
  Windows: function () {
    return navigator.userAgent.match(/IEMobile/i);
  },
  any: function () {
    return (isIncompatible.Android() || isIncompatible.BlackBerry() || isIncompatible.iOS() || isIncompatible.Opera() || isIncompatible.Safari() || isIncompatible.Windows());
  }
};
