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

app.get("/camera/:id", function (req, res, next) {
    const cameraId = req.params['id'];
    console.log(`Received request to get stream from camera: ${cameraId}`);
    let webSocket = cameraSockets.get(cameraId);
    if (webSocket) {
        console.log('Camera found sending START message');
        cameraHttpRes.set(cameraId, res);
    //    webSocket.send("START", next);
        res.writeHead(200, {
            'Cache-Control': 'no-cache, no-store, max-age=0, must-revalidate',
            'Connection': 'keep-alive',
            // here we define the boundary marker for browser to identify subsequent frames
            'Content-Type': `multipart/x-mixed-replace;boundary="${BOUNDARY}"`,
            'Expires': 0,
            'Pragma': 'no-cache'
        });

        res.on('close', () => {
            console.log('Response close');
            res.end();
            cameraHttpRes.delete(cameraId);
        });

        res.on('error', (err) => {
            console.log('Response error', err);
        });

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

wss.on('error', (serv: any, err: Error) => {
    console.log('WSS error', err);
});

function handleStreamWs(cameraId: string, ws: ExtWebSocket) {
    cameraSockets.set(cameraId, ws);
    console.log(`Camera stream with id: '${cameraId}' connected`);

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
        }
    });

    ws.on('close', (event: WebSocket.CloseEvent) => {
        console.log('Camera stream socket closed', cameraId);
        cameraSockets.delete(cameraId);
        let res = cameraHttpRes.get(cameraId);
        if (res) {
            console.log('Response ended');
            try {
                cameraHttpRes.delete(cameraId);
                res.end();
            } catch (e) {
                console.log("Error on close", e);
            }
        }
    });

    ws.on('error', (socket: WebSocket, err: Error) => {
        console.log('Error on socket', err);
    });

    //send immediatly a feedback to the incoming connection
    ws.send('OK');
}

function handleCommandWs(cameraId: string, ws: ExtWebSocket) {
    cameraSockets.set(cameraId, ws);
    console.log(`Camera with id: '${cameraId}' connected`);

    //connection is up, let's add a simple simple event
    ws.on('message', (message: string) => {
        console.log('Message from command queue received', message);
    });

    ws.on('close', (event: WebSocket.CloseEvent) => {
        console.log('Command socket closed', cameraId);
    });

    ws.on('error', (socket: WebSocket, err: Error) => {
        console.log('Error on command socket', err);
    });

    //send immediatly a feedback to the incoming connection
    ws.send('OK');
}


wss.on('connection', (ws: ExtWebSocket, req: http.IncomingMessage) => {
    ws.isAlive = true;

    ws.on('pong', () => {
        console.log('Received pong');
        ws.isAlive = true;
    });

    console.log('Received connection req with url', req.url);
    let urlPaths = req.url ? req.url.substr(1).split('/') : ['undef', 'undef'];
    const cameraId = urlPaths[0];
    const queueId = urlPaths[1];

    if (queueId === 'stream') {
        handleStreamWs(cameraId, ws);
    } else if (queueId === 'command') {
        handleCommandWs(cameraId, ws);
    }
});

setInterval(() => {
    wss.clients.forEach((ws: WebSocket) => {
        const extWs = ws as ExtWebSocket;
        if (!extWs.isAlive) {
            console.log('Connection not alive, terminating');
            return ws.terminate();
        }

        extWs.isAlive = false;
        ws.ping(null, false);
    });
}, 30000);

//start our server
server.listen(process.env.PORT || 8999, () => {
    console.log(`Server started on port ${(server.address() as AddressInfo).port} :)`);
});
