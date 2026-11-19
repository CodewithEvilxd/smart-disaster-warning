# Node.js bridge

Run the bridge and C backend inside WSL. From Windows, open Ubuntu/WSL and use:

```bash
cd /mnt/c/Users/"Nishant Gaurav"/Downloads/os
make -C core
cd bridge
npm install
node server.js -- --seed 42 --sensors 4
```

The bridge starts `../core/disaster_warning` by default, serves WebSockets on
port 8080, and exposes `http://localhost:8080/health`. On Windows, connect the
dashboard or a WebSocket client to `ws://localhost:8080`; WSL's localhost
forwarding makes the Linux bridge available to Windows clients.

Set `PORT` to choose another port. Use `--binary PATH` before the `--` separator
to select a different backend executable, and pass `--auto-restart` before `--`
to restart the backend after it exits. Arguments after `--` go directly to the C
program:

```bash
PORT=8090 node server.js --auto-restart -- --seed 42 --sensors 4 --inject-fault 1@5
```

The first WebSocket message is a snapshot containing up to the last 500 events
and the bridge's derived sensor, queue, scheduler, and memory state. `Ctrl+C`
sends SIGINT to the backend, waits for it to exit, and then closes the bridge.

To run the sample client from another WSL terminal:

```bash
cd /mnt/c/Users/"Nishant Gaurav"/Downloads/os/bridge
node test-client.js
```
