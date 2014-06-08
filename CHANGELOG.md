# Semlocks
Mind-blowingly simple local resource management

##ChangeLog

### Development HEAD
- Add priority option to allow semaphore requests to jump in line
- Callbacks are now called with just one 'release' function that can be called
without arguments to release all held semaphores, or with a semaphore/array of
semaphores to release a subset of the awarded locks.

### v0.1.1
- Drop attempted (but already non-functioning) support for pre-0.10.0 version
of node; process.nextTick is too unpredictable
- Documentation updates

### v0.1.0
- **Initial Release**
