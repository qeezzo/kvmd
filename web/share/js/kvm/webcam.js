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
	function updateUi_isActuallyStreaming(streaming) {
		if (streaming) {
			webcamDropdown.classList.add('streaming');
		} else {
			webcamDropdown.classList.remove('streaming');
		}
	}

	let ws;
	let videoStream;
	let streamingBtnClicked = false;
	let offerCreated = false;

	let peerDataChannel;
	let peerAudioTrack;
	const pc = new RTCPeerConnection();
	pc.onicecandidate = (event) => {
		if (event.candidate) {
			console.log("Sending ICE candidate");
			ws.send(JSON.stringify({ ice: event.candidate }));
		}
	};
	pc.onconnectionstatechange = () => console.log("Peer connection state:", pc.connectionState);

	function setupPeerDataChannel() {
		if (peerDataChannel) return;
		console.log("Setting up Peer Data Channel...")
		peerDataChannel = pc.createDataChannel("mjpegStream");
		peerDataChannel.onopen = () => {
			if (streamingBtnClicked) {
				updateUi_isActuallyStreaming(true);
			}
			console.log("Peer DataChannel opened");
		}
		peerDataChannel.onclose = () => {
			updateUi_isActuallyStreaming(false);
			peerDataChannel = null;
			console.log("Peer DataChannel closed");
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

		console.log("Connecting WebSocket...")

		webcamMenu.classList.remove("failed", "connected");
		webcamMenu.classList.add("connecting")

		const ws_host = window.location.hostname;
		const ws_port = 3000;

		try {
			ws = new WebSocket(`wss://${ws_host}:${ws_port}`);
			ws.onopen = () => {
				console.log("WebSocket connected");
				updateUi_isConnected(true)

				setupPeerDataChannel();
				if (!offerCreated) {
					try {
						createWebrtcOffer();
					} catch(error) {
						console.error("Offer creation failed", error);
					}
				}
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
		console.log("Disconnecting...")
		if (ws) {
			try {
				ws.close();
			} catch(error) {
				console.error("Error closing WebSocket:", error);
			}
			ws = null;
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

	async function createWebrtcOffer() {
		offerCreated = false;
		if (!ws) {
			console.log("No WebSocket. Cannot create offer.");
			// Will be created when ws opens
			return;
		}
		const offer = await pc.createOffer();
		await pc.setLocalDescription(offer);
		ws.send(JSON.stringify({ sdp: offer }));

		offerCreated = true;
	}

	// Capture Video Stream
	let debounce = false;
	async function restartCapture() {
		if (debounce) return;
		console.log("Restarting capture");

		debounce = true;
		stopCapture();

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
				peerAudioTrack = pc.addTrack(audioTrack, videoStream);
				console.log("Audio track added to WebRTC connection.");
			} else {
				console.warn("No audio track found.");
			}

			offerCreated = false;
			createWebrtcOffer();
		} catch (error) {
			console.error("Error accessing camera/audio:", error);
		}
	}
	function stopCapture() {
		if (!videoStream) return;
		console.log("Stopping capture")

		offerCreated = false;
		videoElement.srcObject = null;

		videoStream.getTracks().forEach((track) => {
			track.stop();
		});
		if (peerAudioTrack) {
			pc.removeTrack(peerAudioTrack);
		}
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
		} else if (!streamingBtnClicked) {
			disconnect();
			stopCapture();
		}
	});

	let frameIntervalId;  // Store the interval reference to clear it later
	let frameInterval = 1000 / 30; // Frame interval for 30 FPS
	let lastFrameTime = 0;  // Last time a frame was sent (in ms)
	let frameCount = 0;     // Counter for frames sent in the current second

	// Send Frames with Controlled FPS (Handles MJPEG & Raw Automatically)
	function startStreaming() {
		if (frameIntervalId) return;
		frameIntervalId = setInterval(() => {
			if (!streamingBtnClicked) return;
			if (!videoElement.videoWidth || !videoElement.videoHeight) return;

			// Set canvas size
			canvas.width = videoElement.videoWidth;
			canvas.height = videoElement.videoHeight;

			// Draw the current frame onto the canvas
			ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

			if (streamingBtnClicked && peerDataChannel.readyState === "open") {
				updateUi_isActuallyStreaming(true);
			}

			// Send as MJPEG (if available)
			canvas.toBlob((blob) => {
				if (peerDataChannel.readyState !== "open") return;
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
		}, frameInterval);  // Send a frame every "frameInterval" milliseconds (e.g., 33ms for 30 FPS)
	}

	// Stop sending frames
	function stopStreaming() {
		if (!frameIntervalId) return;
		updateUi_isActuallyStreaming(false);
		clearInterval(frameIntervalId);
		frameIntervalId = null;
	}

	// Start streaming when button is clicked
	startButton.addEventListener("click", () => {
		streamingBtnClicked = !streamingBtnClicked;
		startButton.textContent = streamingBtnClicked ? "Stop Streaming" : "Start Streaming";

		if (streamingBtnClicked) {
			startStreaming();  // Begin sending frames when streaming starts
		} else {
			stopStreaming();   // Stop sending frames when streaming stops
		}
	});

	// Trigger a capture with the selected resolution when it changes
	resolutionSelect.addEventListener("change", restartCapture)
}
