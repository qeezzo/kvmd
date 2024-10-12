const http = require('node:http');
const express = require('express');

const app = express();
const server = http.createServer(app)
const io = require('socket.io')(server, {
	cors: {
		origin: '*'
	},
	perMessageDeflate: false,
});

const { ExpressPeerServer } = require('peer');

server.listen(3000, '0.0.0.0', () => {
  console.log('Server is running on port 3000');
});

const peerServer = ExpressPeerServer(server, {
	debug: true
})

app.use('/peerjs', peerServer);
app.use(express.static('.'));

io.on('connection', socket => {
	console.log('a user connected');

	socket.on('disconnect', () => {
			console.log('user disconnected');
	});

	socket.on('call-user', (data) => {
			console.log(`call-user event from ${data.callerID} to ${data.userID}`);
			socket.to(data.userID).emit('call-made', {
					offer: data.offer,
					callerID: data.callerID
			});
	});

	socket.on('make-answer', data => {
			console.log(`make-answer event from ${data.calleeID} to ${data.callerID}`);
			socket.to(data.callerID).emit('answer-made', {
					answer: data.answer,
					calleeID: data.calleeID
			});
	});

	socket.on('reject-call', data => {
			console.log(`reject-call event from ${data.calleeID} to ${data.callerID}`);
			socket.to(data.callerID).emit('call-rejected', {
					calleeID: data.calleeID
			});
	});

	socket.on('user-connected', (userID) => {
			console.log(`user-connected event for ${userID}`);
			socket.broadcast.emit('user-connected', userID);
	});

	socket.on('user-disconnected', (userID) => {
			console.log(`user-disconnected event for ${userID}`);
			socket.broadcast.emit('user-disconnected', userID);
	});
});

app.get('/', (req, res, next) => res.redirect('/sender.html'));
app.get('/receiver', (req, res, next) => res.redirect('/receiver.html'));
