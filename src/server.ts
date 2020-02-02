import * as express from 'express';
import * as http from 'http';
import * as WebSocket from 'ws';
import {AddressInfo} from "ws";
import {Response} from "express";

interface ExtWebSocket extends WebSocket {
    isAlive: boolean;
}

const app = express();
const cameraSockets: Map<string, ExtWebSocket> = new Map<string, ExtWebSocket>();

const cameraHttpRes: Map<String, Response> = new Map<String, Response>();
const BOUNDARY = 'MYBOUNDARY';

function sendStopToCamera(cameraId: string) {
    let webSocket = cameraSockets.get(cameraId);
    if (webSocket) {
        webSocket.send('STOP', (err) => {
            console.log('Error while sending END to camera socket', err);
        });
    }
}

app.get("/camera/:id", function (req, res, next) {
    const cameraId = req.params['id'];
    console.log(`Received request to get stream from camera: ${cameraId}`);
    let webSocket = cameraSockets.get(cameraId);
    if (webSocket) {
        console.log('Camera found sending START message');
        cameraHttpRes.set(cameraId, res);
        webSocket.send("START", next);
        res.writeHead(200, {
            'Cache-Control': 'no-cache, no-store, max-age=0, must-revalidate',
            'Connection': 'keep-alive',
            // here we define the boundary marker for browser to identify subsequent frames
            'Content-Type': `multipart/x-mixed-replace;boundary="${BOUNDARY}"`,
            'Expires': 0,
            'Pragma': 'no-cache'
        });

        res.on('close', () => {
            sendStopToCamera(cameraId);
            res.end();
        })

    } else {
        const message = `No connected camera with id '${cameraId}' stream found `;
        console.log(message);
        throw new Error(message)
    }
});

//initialize a simple http server
const server = http.createServer(app);

//initialize the WebSocket server instance
const wss = new WebSocket.Server({server});

wss.on('connection', (ws: ExtWebSocket, req: http.IncomingMessage) => {
    ws.isAlive = true;

    ws.on('pong', () => {
        ws.isAlive = true;
    });

    const cameraId = req.url ? req.url.substr(1) : 'undef';
    cameraSockets.set(cameraId, ws);
    console.log(`Camera with id: '${cameraId}' connected`);

    //connection is up, let's add a simple simple event
    ws.on('message', (message: Buffer) => {
        ws.isAlive = true;
        let res = cameraHttpRes.get(cameraId);
        if (res && !res.writableEnded) {
            res.write(`--${BOUNDARY}\r\n`);
            res.write('Content-Type: image/jpeg\r\n');
            res.write(`Content-Length: ${message.length}\r\n`);
            res.write('\r\n');
            res.write(message, 'binary');
            res.write('\r\n');
        } else {
            sendStopToCamera(cameraId);
        }

        ws.send('OK');
    });

    ws.on('close', (event: WebSocket.CloseEvent) => {
        console.log('Camera socket closed', cameraId);
        cameraSockets.delete(cameraId);
        let res = cameraHttpRes.get(cameraId);
        if (res) {
            console.log('Response ended');
            res.end();
            cameraHttpRes.delete(cameraId);
        }
    });

    //send immediatly a feedback to the incoming connection
    ws.send('OK');
});

setInterval(() => {
    wss.clients.forEach((ws: WebSocket) => {
        const extWs = ws as ExtWebSocket;
        if (!extWs.isAlive) return ws.terminate();

        extWs.isAlive = false;
        ws.ping(null, false);
    });
}, 30000);

//start our server
server.listen(process.env.PORT || 8999, () => {
    console.log(`Server started on port ${(server.address() as AddressInfo).port} :)`);
});
