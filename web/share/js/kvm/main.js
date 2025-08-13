"use strict";

import {tools, $} from "../tools.js";
import {checkBrowser} from "../bb.js";
import {wm, initWindowManager} from "../wm.js";

import {Session} from "./session.js";

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
	let sendingFrames = false;

	const videoElement = document.getElementById("localVideo");
	const canvas = document.getElementById("canvas");
	const ctx = canvas.getContext("2d");
	const resolutionSelect = document.getElementById("resolution");
	const startButton = document.getElementById("startButton");
	const webcamDropdown = document.getElementById("webcam-dropdown")
	const webcamMenu = document.getElementById("webcam-menu")
	
	function updateUi_isConnected(connected) {
		if (connected) {
			webcamMenu.classList.add("connected");
		} else {
			webcamMenu.classList.remove("connected");
		}
	}
	function updateUi_isStreaming(streaming) {
		if (streaming) {
			webcamDropdown.classList.add('streaming');
		} else {
			webcamDropdown.classList.remove('streaming');
		}
	}

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
		dataChannel.onopen = () => {
			if (sendingFrames) {
				updateUi_isStreaming(true);
			}
			console.log("DataChannel opened");
		}
		dataChannel.onclose = () => {
			updateUi_isStreaming(false);
			console.log("DataChannel closed");
		}
	}

	function tryReconnect() {
		webcamMenu.classList.remove("connecting", "connected");
		webcamMenu.classList.add("failed");
		setTimeout(() => {
			webcamMenu.classList.remove("failed");

			if (videoStream) {
				connect();
			};
		}, 1000);
	}

	function connect() {
		if (ws && ws.readyState === WebSocket.OPEN) {
			console.log("Already connected");
			return;
		}

		webcamMenu.classList.remove("failed", "connected");
		webcamMenu.classList.add("connecting")

		const ws_host = window.location.hostname;
		const ws_port = 3000;

		try {
			ws = new WebSocket(`wss://${ws_host}:${ws_port}`);
			ws.onopen = () => {
				console.log("WebSocket connected");
				updateUi_isConnected(true)

				setupPeerConnection();
				restartCapture();
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
				updateUi_isConnected(false);
				tryReconnect();
			};
			ws.onerror = (err) => {
				console.error("WebSocket error", err);
			};
		} catch (error) {
			console.log("WebSocket connect failed", error);
			tryReconnect();
		}
	}

	function disconnect() {
		if (ws) {
			ws.close();
			ws = null;
		}
		if (pc) {
			pc.close();
			pc = null;
			if (dataChannel) {
				dataChannel.close();
				dataChannel = null;
			}
		}
		stopSendingFrames();
	}

	// Capture Video Stream
	let debounce = false;
	async function restartCapture() {
		if (debounce) return;
		console.log("Restarting capture")

		debounce = true;

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
			debounce = false;

			if (!videoStream) return; // Was stopped

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

	function stopCapture() {
		if (!videoStream) return;
		console.log("Stopping capture")

		videoElement.srcObject = null;

		videoStream.getTracks().forEach((track) => {
			track.stop();
		});
		videoStream = null;
	}

	// Custom event created in web/share/js/wm.js
	webcamMenu.addEventListener("openChanged", (e) => {
		if (e.detail.open) {
			if (!videoStream) {
				restartCapture();
			}
			if (!ws) {
				connect();
			}
		} else if (!sendingFrames) {
			disconnect();
			stopCapture();
		}
	});

	let frameIntervalId;  // Store the interval reference to clear it later
	let frameInterval = 1000 / 30; // Frame interval for 30 FPS
	let lastFrameTime = 0;  // Last time a frame was sent (in ms)
	let frameCount = 0;     // Counter for frames sent in the current second

	// Send Frames with Controlled FPS (Handles MJPEG & Raw Automatically)
	function startSendingFrames() {
		frameIntervalId = setInterval(() => {
			if (!sendingFrames) return;
			if (!videoElement.videoWidth || !videoElement.videoHeight) return;

			// Set canvas size
			canvas.width = videoElement.videoWidth;
			canvas.height = videoElement.videoHeight;

			// Draw the current frame onto the canvas
			ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

			if (sendingFrames && dataChannel.readyState === "open") {
				updateUi_isStreaming(true);
			}

			// Send as MJPEG (if available)
			canvas.toBlob((blob) => {
				if (dataChannel.readyState !== "open") return;

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
		if (!frameIntervalId) return;
		updateUi_isStreaming(false);
		clearInterval(frameIntervalId);
	}

	// Start streaming when button is clicked
	startButton.addEventListener("click", () => {
		sendingFrames = !sendingFrames;
		startButton.textContent = sendingFrames ? "Stop Streaming" : "Start Streaming";

		if (sendingFrames) {
			startSendingFrames();  // Begin sending frames when streaming starts
		} else {
			stopSendingFrames();   // Stop sending frames when streaming stops
		}
	});

	// Trigger a capture with the selected resolution when it changes
	resolutionSelect.addEventListener("change", () => {
		restartCapture();
	})

	new Session();
}
