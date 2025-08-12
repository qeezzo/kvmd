"use strict";

import {tools, $} from "../tools.js";
import {checkBrowser} from "../bb.js";
import {wm, initWindowManager} from "../wm.js";

import {Session} from "./session.js";
import {Peer} from "https://esm.sh/peerjs@1.5.4?bundle-deps";

export function main() {
    if (!checkBrowser(null, "/share/css/kvm/x-mobile.css")) return;

	tools.storage.bindSimpleSwitch($("page-close-ask-switch"), "page.close.ask", true, function(value) {
		if (value) {
			window.onbeforeunload = function(event) {
				let text = "Are you sure you want to close PiKVM session?";
				if (event) {
					event.returnValue = text;
				}
				return text;
			};
		} else {
			window.onbeforeunload = null;
		}
	});

	initWindowManager();

	tools.el.setOnClick($("open-log-button"), () => window.open("/api/log?seek=3600&follow=1", "_blank"));

	if (tools.config.getBool("kvm--full-tab-stream", false)) {
		wm.toggleFullTabWindow($("stream-window"), true);
	}
	wm.showWindow($("stream-window"));

	let ws;
	let pc;
	let dataChannel;
	let videoStream;
	let sendFrameStopEvent = true;

	const videoElement = document.getElementById("localVideo");
	const canvas = document.getElementById("canvas");
	const ctx = canvas.getContext("2d");
	const startButton = document.getElementById("startButton");
	const resolutionSelect = document.getElementById("resolution");
	const connectButton = document.getElementById("connectButton");
	const reconnectButton = document.getElementById("reconnectButton");
	const disconnectButton = document.getElementById("disconnectButton");
	

	function setupPeerConnection() {
		pc = new RTCPeerConnection();
		pc.onicecandidate = (event) => {
			if (event.candidate) {
			console.log("Sending ICE candidate");
			ws.send(JSON.stringify({ ice: event.candidate }));
			}
		};
		pc.onconnectionstatechange = () => console.log("Connection state:", pc.connectionState);
		dataChannel = pc.createDataChannel("mjpegStream");
		dataChannel.onopen = () => console.log("DataChannel opened");
		dataChannel.onclose = () => console.log("DataChannel closed");
	}

	function connect() {
		if (ws && ws.readyState === WebSocket.OPEN) {
			console.log("Already connected");
			return;
		}
		const ws_host = window.location.hostname;
		const ws_port = 3000;
		ws = new WebSocket(`wss://${ws_host}:${ws_port}`);
		ws.onopen = () => {
			console.log("WebSocket connected");
			setupPeerConnection();
			startCapture();
		};
		ws.onmessage = async (message) => {
			const msg = JSON.parse(message.data);
			if (msg.sdp) {
			await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
			} else if (msg.ice) {
			await pc.addIceCandidate(new RTCIceCandidate(msg.ice));
			}
		};
		ws.onclose = () => {
			console.log("WebSocket closed");
		};
		ws.onerror = (err) => {
			console.error("WebSocket error", err);
		};
	}

	function disconnect() {
		if (ws) {
			ws.close();
			ws = null;
		}
		if (pc) {
			pc.close();
			pc = null;
		}
	}

	connectButton.addEventListener("click", connect);
	disconnectButton.addEventListener("click", disconnect);
	reconnectButton.addEventListener("click", () => {
		disconnect();
		setTimeout(connect, 500);
	});

	// Capture Video Stream
	async function startCapture() {
		const [width, height] = resolutionSelect.value.split("x").map(Number);
		try {
			videoStream = await navigator.mediaDevices.getUserMedia({
			video: {
				mimeType: "image/jpeg",
				width,
				height
			},
			audio: {
				codec: "opus",
			}
			});
			videoElement.srcObject = videoStream;
			console.log(`Camera access granted at ${width}x${height}`);

			const track = videoStream.getVideoTracks()[0];
			const capabilities = track.getCapabilities();
			console.log("Camera Capabilities:", capabilities);


			// Audio track
			const audioTrack = videoStream.getAudioTracks()[0];
			if (audioTrack) {
			pc.addTrack(audioTrack, videoStream);
			console.log("Audio track added to WebRTC connection.");
			} else {
			console.warn("No audio track found.");
			}

			// Create WebRTC Offer
			const offer = await pc.createOffer();
			await pc.setLocalDescription(offer);
			ws.send(JSON.stringify({ sdp: offer }));

		} catch (error) {
			console.error("Error accessing camera/audio:", error);
		}
	}

	let frameIntervalId;  // Store the interval reference to clear it later
	let frameInterval = 1000 / 30; // Frame interval for 30 FPS
	let lastFrameTime = 0;  // Last time a frame was sent (in ms)
	let frameCount = 0;     // Counter for frames sent in the current second

	// Send Frames with Controlled FPS (Handles MJPEG & Raw Automatically)
	function startSendingFrames() {
		frameIntervalId = setInterval(() => {
			if (sendFrameStopEvent) return;

			if (!videoElement.videoWidth || !videoElement.videoHeight) return;

			// Set canvas size
			canvas.width = videoElement.videoWidth;
			canvas.height = videoElement.videoHeight;

			// Draw the current frame onto the canvas
			ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

			// Send as MJPEG (if available)
			canvas.toBlob((blob) => {
			if (dataChannel.readyState !== "open")
				return;

			// console.log(blob.size)
			dataChannel.send(blob);

			// Calculate FPS
			let now = performance.now(); // Get current time in milliseconds
			frameCount++;

			// If more than 1 second has passed, log FPS
			if (now - lastFrameTime >= 1000) {
				let actualFPS = frameCount;
				console.log(`Actual FPS: ${actualFPS}`);
				lastFrameTime = now; // Update last frame time
				frameCount = 0;      // Reset frame count for the next second
			}
			}, "image/jpeg", 0.4);

		}, frameInterval);  // Send a frame every "frameInterval" milliseconds (e.g., 33ms for 30 FPS)
	}

	// Stop sending frames
	function stopSendingFrames() {
		clearInterval(frameIntervalId);
	}

	// Start streaming when button is clicked
	startButton.addEventListener("click", () => {
		sendFrameStopEvent = !sendFrameStopEvent;
		startButton.textContent = sendFrameStopEvent ? "Start Streaming" : "Stop Streaming";
		if (!sendFrameStopEvent) {
			startSendingFrames();  // Begin sending frames when streaming starts
		} else {
			stopSendingFrames();   // Stop sending frames when streaming stops
		}
	});

	// Trigger a capture with the selected resolution when it changes
	resolutionSelect.addEventListener("change", () => {
		startCapture();
	})

	// startCapture();
	new Session();
}
