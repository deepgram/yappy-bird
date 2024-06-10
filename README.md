Yappy Bird
==========

Yappy Bird is a variant of the popular game "Flappy Bird," where players control the game using voice commands to make the bird flap and navigate through obstacles. This version integrates real-time voice recognition using the Deepgram API to process audio input from the player.

Usage
---

Start the game by saying `start` or `yap down for what` (mousedown and keydown also work).

Flap by saying `yap`, `flap`, or `up` (which seems to work best by actually saying `go up`).

Get the high score, become King/Queen of the Yap.


Installation
---
Clone the repo and `cd` to its directory.

```
npm i
npm run start
```

Navigate to `http://localhost:8000` in your browser. (For easy mode navigate to `http://localhost:8000?easy`).

Notes
---
* Does _not_ work in Firefox. Works well in Chrome.
* Microphone access must be allowed.

## Attribution

This project is based on the [Handy Bird](https://github.com/wanderingstan/handybird) project by Stan James.
