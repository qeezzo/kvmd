/*****************************************************************************
#                                                                            #
#    KVMD - The main PiKVM daemon.                                           #
#                                                                            #
#    Copyright (C) 2018-2024  Maxim Devaev <mdevaev@gmail.com>               #
#                                                                            #
#    This program is free software: you can redistribute it and/or modify    #
#    it under the terms of the GNU General Public License as published by    #
#    the Free Software Foundation, either version 3 of the License, or       #
#    (at your option) any later version.                                     #
#                                                                            #
#    This program is distributed in the hope that it will be useful,         #
#    but WITHOUT ANY WARRANTY; without even the implied warranty of          #
#    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the           #
#    GNU General Public License for more details.                            #
#                                                                            #
#    You should have received a copy of the GNU General Public License       #
#    along with this program.  If not, see <https://www.gnu.org/licenses/>.  #
#                                                                            #
*****************************************************************************/

"use strict";

export function Webcam() {
	var self = this;

	const videoElement = document.getElementById("localVideo");
	videoElement.muted = false; // Allow for preview sound
	const canvas = document.getElementById("canvas");
	const ctx = canvas.getContext("2d");
	const resolutionSelect = document.getElementById("resolution");
	const startButton = document.getElementById("startButton");
	const webcamDropdown = document.getElementById("webcam-dropdown")
	const webcamMenu = document.getElementById("webcam-menu")
	const webcamLed = document.getElementById("webcam-led")
	
	function updateUi_isConnected(connected) {
		if (connected) {
			webcamMenu.classList.add("connected");
		} else {
			webcamMenu.classList.remove("connected");
		}
	}
	function updateUi_isStreamingClicked(streaming) {
		if (streaming) {
			webcamDropdown.classList.add('streaming');
		} else {
			webcamDropdown.classList.remove('streaming');
		}
	}

	let isInit = false;
	let ws;
	let videoStream;
	let streamingBtnClicked = false;
	let isMenuOpen = false;
	let isCapturing = false;

	let pc;
	let peerDataChannel;
	let peerAudioTrack;

	var __updateOnlineLeds = function() {
		let led = "led-gray";
		let title = "Webcam OFF";

		if (isCapturing && pc) {
			if (videoStream) {
				if (pc.connectionState === "connecting" || pc.connectionState === "new") {
					led = "led-yellow";
					title = "Webcam connecting";
				} else if (pc.connectionState === "connected") {
					if (streamingBtnClicked) {
						led = "led-green";
						title = "Webcam retranslated";
					} else {
						led = "led-yellow";
						title = "Webcam prepared";
					}
				} else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
					led = "led-red";
					title = "Webcam failed";
				}
			} else {
				led = "led-red";
				title = "Webcam not granted";
			}
		}
		webcamLed.className = led;
		webcamLed.title = title;
	};
	__updateOnlineLeds();

	function setupPeerConnection() {
		if (pc) return;
		console.log("Setting up Peer connection...")

		pc = new RTCPeerConnection();
		pc.onicecandidate = (event) => {
			if (event.candidate) {
				console.log("Sending ICE candidate");
				ws.send(JSON.stringify({ ice: event.candidate }));
			}
		};
		pc.onconnectionstatechange = () => {
			console.log("Peer connection state:", pc.connectionState);
			__updateOnlineLeds();
		}
		console.log(pc.connectionState)
		peerDataChannel = pc.createDataChannel("mjpegStream");
		peerDataChannel.onopen = () => {
			console.log("Peer DataChannel opened");
		}
		peerDataChannel.onclose = () => {
			peerDataChannel = null;
			console.log("Peer DataChannel closed");
		}

		__updateOnlineLeds();
	}

	let reconnectionId = null;
	function tryReconnectWs() {
		if (reconnectionId !== null || !shouldBeConnected()) return;

		let reconnect = async () => {
			webcamMenu.classList.remove("connecting", "connected");
			webcamMenu.classList.add("failed");

			if (!isInit) return; // if the whole page is suspended by kvmd's WebSocket, do nothing
			webcamMenu.classList.remove("failed");
			if (!shouldBeConnected()) {
				cancelReconnection();
				return;
			}

			if (videoStream) {
				connectWs();
			};
		}
		reconnectionId = setInterval(reconnect, 1000);
		reconnect();
	}
	function cancelReconnection() {
		if (reconnectionId !== null) {
			clearInterval(reconnectionId);
			reconnectionId = null;
		}
	}
	function connectWs() {
		if (ws) return;
		if (!isInit) {
			tryReconnectWs();
			return;
		}

		console.log("Connecting WebSocket...")

		webcamMenu.classList.remove("failed", "connected");
		webcamMenu.classList.add("connecting")

		const ws_host = window.location.hostname;
		const ws_port = 3000;

		try {
			ws = new WebSocket(`wss://${ws_host}:${ws_port}`);
			ws.onopen = () => {
				console.log("WebSocket connected");
				updateUi_isConnected(true);

				// Restore everything if the streaming is enabled by user
				if (streamingBtnClicked)
					startStreaming();
				setupPeerConnection();
				tryAddAudioTrack();
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

				ws = null;
				// when ws is disconnected, we assume the server shouldn't be interacted with anymore
				disconnectAll();
				tryReconnectWs();
			};
			ws.onerror = (err) => {
				console.error("WebSocket error", err);
			};

			cancelReconnection();
		} catch (error) {
			console.log("WebSocket connect failed", error);
			tryReconnectWs();
		}
	}
	function disconnectAll() {
		if (ws) {
			try {
				ws.close();
			} catch(error) {
				console.error("Error closing WebSocket:", error);
			}
			ws = null;
		}
		if (pc) {
			peerAudioTrack = null;
			try {
				pc.close();
			} catch(error) {
				console.error("Error closing Peer connection:", error);
			}
			pc = null;
			__updateOnlineLeds();
		}
		if (peerDataChannel) {
			try {
				peerDataChannel.close();
			} catch(error) {
				console.error("Error closing Peer DataChannel:", error);
			}
			peerDataChannel = null;
		}
		stopStreaming();
	}

	async function tryCreateWebrtcOffer() {
		if (!pc || !videoStream) return;
		console.log("Creating offer...")

		const offer = await pc.createOffer();
		if (!pc) return;
		await pc.setLocalDescription(offer);
		if (!ws) return;
		ws.send(JSON.stringify({ sdp: offer }));
	}

	// Capture Video Stream
	let _captureDebounce = false;
	async function restartCapture() {
		if (_captureDebounce) return;
		console.log("Restarting capture");

		_captureDebounce = true;
		stopCapture();
		isCapturing = true;

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
			_captureDebounce = false;

			if (!isCapturing) {
				// Was stopped
				stopCapture();
				return;
			}

			videoElement.srcObject = videoStream;
			console.log(`Camera access granted at ${width}x${height}`);

			const track = videoStream.getVideoTracks()[0];
			const capabilities = track.getCapabilities();
			console.log("Camera Capabilities:", capabilities);

			__updateOnlineLeds();
			tryAddAudioTrack();
		} catch (error) {
			console.error("Error accessing camera/audio:", error);
			_captureDebounce = false;
		}
	}
	function stopCapture() {
		isCapturing = false;
		if (!videoStream) return;
		console.log("Stopping capture")

		__updateOnlineLeds();
		videoElement.srcObject = null;

		videoStream.getTracks().forEach((track) => {
			track.stop();
		});
		videoStream = null;

		if (pc && peerAudioTrack) {
			pc.removeTrack(peerAudioTrack);
		}
		peerAudioTrack = null;
	}
	function tryAddAudioTrack() {
		if (!pc || !videoStream || !streamingBtnClicked || peerAudioTrack) return;
		const audioTrack = videoStream.getAudioTracks()[0];
		if (audioTrack) {
			peerAudioTrack = pc.addTrack(audioTrack, videoStream);
			console.log("Audio track added to WebRTC connection.");
		} else {
			console.warn("No audio track found.");
		}
		tryCreateWebrtcOffer();
	}

	function shouldBeConnected() {
		return streamingBtnClicked || isMenuOpen;
	}

	// Custom event created in web/share/js/wm.js
	webcamMenu.addEventListener("openChanged", (e) => {
		if (e.detail.open) {
			isMenuOpen = true;
			if (!videoStream) {
				restartCapture();
			}
			if (!ws) {
				connectWs();
			}
		} else {
			isMenuOpen = false;
			if (!shouldBeConnected()) {
				disconnectAll();
				stopCapture();
			}
		}
	});

	const FRAME_INTERVAL = 1000 / 30; // Frame interval for 30 FPS
	let frameIntervalId = null;  // Store the interval reference to clear it later
	let lastFrameTime = 0;  // Last time a frame was sent (in ms)
	let frameCount = 0;     // Counter for frames sent in the current second

	// Send Frames with Controlled FPS (Handles MJPEG & Raw Automatically)
	function startStreaming() {
		if (frameIntervalId !== null) return;
		tryAddAudioTrack();
		
		frameIntervalId = setInterval(() => {
			if (!videoElement.videoWidth || !videoElement.videoHeight) return;

			// Set canvas size
			canvas.width = videoElement.videoWidth;
			canvas.height = videoElement.videoHeight;

			// Draw the current frame onto the canvas
			ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

			if (!peerDataChannel || !streamingBtnClicked) return;

			// Send as MJPEG (if available)
			canvas.toBlob((blob) => {
				if (!streamingBtnClicked || !peerDataChannel || peerDataChannel.readyState !== "open") return;
				peerDataChannel.send(blob);

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
		}, FRAME_INTERVAL);  // Send a frame every "frameInterval" milliseconds (e.g., 33ms for 30 FPS)
	}

	// Stop sending frames
	function stopStreaming() {
		if (frameIntervalId === null) return;
		clearInterval(frameIntervalId);
		frameIntervalId = null;

		frameCount = 0;
		lastFrameTime = 0;

		if (pc && peerAudioTrack) {
			pc.removeTrack(peerAudioTrack);
		}
		peerAudioTrack = null;
	}

	// Start streaming when button is clicked
	startButton.addEventListener("click", () => {
		streamingBtnClicked = !streamingBtnClicked;
		startButton.textContent = streamingBtnClicked ? "Stop Streaming" : "Start Streaming";
		updateUi_isStreamingClicked(streamingBtnClicked);

		if (streamingBtnClicked) {
			videoElement.muted = true;
			startStreaming();  // Begin sending frames when streaming starts
		} else {
			videoElement.muted = false;
			stopStreaming();   // Stop sending frames when streaming stops
		}

		__updateOnlineLeds();
	});

	// Trigger a capture with the selected resolution when it changes
	resolutionSelect.addEventListener("change", restartCapture);

	self.init = () => {
		isInit = true;
		if (streamingBtnClicked) {
			startStreaming();
		}
	}
	self.cleanup = () => {
		isInit = false;
		disconnectAll();
	}
}
