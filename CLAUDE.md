# Purpose

The goal of this project is to write a parser for Tribes 2 demo recordings, which
are saved in .rec files. Tribes 2 used an early version of the Torque3D game engine.

The output of parsing these recordings will resemble a timeseries of world events
and transformations: for example, player movement, flag captures, projectiles,
animations, etc. Using this output, we ultimately hope to create KeyframeTrack
and AnimationClip objects in Three.js, and play them back with an AnimationMixer.

# Reference Material

- The `reference` folder contains reference material. Some of the files or
  directories within may be symlinks to additional material. If those symlinked
  folders have a CLAUDE.md file, be sure to read it as well.
- `reference/TorqueEngineResources`: This symlinked folder contains the majority
  of materials that will be helpful for this task.
