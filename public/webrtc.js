class WebRTCManager {
    constructor() {
        this.localStream = null;
        this.remoteStream = null;
        this.peerConnection = null;
        this.iceServers = null;
        this.isCallActive = false;
        this.isMuted = false;
        this.callTimer = null;
        this.callStartTime = null;
    }

    async initializeWebRTC(iceServers) {
        this.iceServers = iceServers;
        
        try {
            // Get user media (audio only)
            this.localStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 44100
                },
                video: false 
            });
            
            document.getElementById('local-audio').srcObject = this.localStream;
            return true;
        } catch (error) {
            console.error('Error accessing microphone:', error);
            this.showPermissionScreen();
            return false;
        }
    }

    createPeerConnection() {
        this.peerConnection = new RTCPeerConnection(this.iceServers);

        // Add local stream tracks
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                this.peerConnection.addTrack(track, this.localStream);
            });
        }

        // Handle remote stream
        this.peerConnection.ontrack = (event) => {
            console.log('Received remote stream');
            this.remoteStream = event.streams[0];
            document.getElementById('remote-audio').srcObject = this.remoteStream;
        };

        // Handle ICE candidates
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate && window.socket) {
                window.socket.emit('ice-candidate', {
                    candidate: event.candidate,
                    target: this.targetSocketId
                });
            }
        };

        // Handle connection state changes
        this.peerConnection.onconnectionstatechange = () => {
            console.log('Connection state:', this.peerConnection.connectionState);
            
            if (this.peerConnection.connectionState === 'connected') {
                this.startCallTimer();
                document.getElementById('call-status-text').textContent = 'Connected';
                window.authManager.showToast('Call connected', 'success');
            } else if (this.peerConnection.connectionState === 'disconnected' || 
                      this.peerConnection.connectionState === 'failed') {
                window.authManager.showToast('Call disconnected', 'error');
                this.endCall();
            } else if (this.peerConnection.connectionState === 'connecting') {
                document.getElementById('call-status-text').textContent = 'Connecting...';
            }
        };
        
        // Handle ICE connection state changes
        this.peerConnection.oniceconnectionstatechange = () => {
            console.log('ICE connection state:', this.peerConnection.iceConnectionState);
            
            if (this.peerConnection.iceConnectionState === 'failed') {
                console.log('ICE connection failed, attempting restart');
                this.peerConnection.restartIce();
            }
        };
    }

    async createOffer(targetSocketId) {
        this.targetSocketId = targetSocketId;
        this.createPeerConnection();

        try {
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);
            
            window.socket.emit('offer', {
                offer: offer,
                target: targetSocketId
            });
        } catch (error) {
            console.error('Error creating offer:', error);
        }
    }

    async handleOffer(offer, senderSocketId) {
        this.targetSocketId = senderSocketId;
        this.createPeerConnection();

        try {
            await this.peerConnection.setRemoteDescription(offer);
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);
            
            window.socket.emit('answer', {
                answer: answer,
                target: senderSocketId
            });
        } catch (error) {
            console.error('Error handling offer:', error);
        }
    }

    async handleAnswer(answer) {
        try {
            await this.peerConnection.setRemoteDescription(answer);
        } catch (error) {
            console.error('Error handling answer:', error);
        }
    }

    async handleIceCandidate(candidate) {
        try {
            if (this.peerConnection) {
                await this.peerConnection.addIceCandidate(candidate);
            }
        } catch (error) {
            console.error('Error handling ICE candidate:', error);
        }
    }

    startCallTimer() {
        this.callStartTime = Date.now();
        this.callTimer = setInterval(() => {
            const elapsed = Math.floor((Date.now() - this.callStartTime) / 1000);
            const hours = Math.floor(elapsed / 3600).toString().padStart(2, '0');
            const minutes = Math.floor((elapsed % 3600) / 60).toString().padStart(2, '0');
            const seconds = (elapsed % 60).toString().padStart(2, '0');
            
            document.getElementById('call-timer').textContent = `${hours}:${minutes}:${seconds}`;
        }, 1000);
    }

    stopCallTimer() {
        if (this.callTimer) {
            clearInterval(this.callTimer);
            this.callTimer = null;
        }
        document.getElementById('call-timer').textContent = '00:00:00';
    }

    toggleMute() {
        if (this.localStream) {
            const audioTrack = this.localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                this.isMuted = !audioTrack.enabled;
                
                const muteBtn = document.getElementById('mute-btn');
                muteBtn.classList.toggle('muted', this.isMuted);
                muteBtn.innerHTML = this.isMuted ? 
                    '<i class="fas fa-microphone-slash"></i>' : 
                    '<i class="fas fa-microphone"></i>';
            }
        }
    }

    endCall() {
        console.log('Ending call...');
        
        this.isCallActive = false;
        this.stopCallTimer();

        // Close peer connection
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }

        // Stop local stream
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }

        // Clear audio elements
        document.getElementById('local-audio').srcObject = null;
        document.getElementById('remote-audio').srcObject = null;

        // Notify the other peer
        if (window.socket && this.targetSocketId) {
            window.socket.emit('end-call', { target: this.targetSocketId });
        }

        // Reset state
        this.targetSocketId = null;
        this.isMuted = false;

        // Return to contacts screen
        setTimeout(() => {
            window.authManager.hideAllScreens();
            document.getElementById('contacts-screen').classList.add('active');
            
            // Refresh contacts list
            if (window.app) {
                window.app.loadContacts();
            }
        }, 1000);
    }

    showPermissionScreen() {
        window.authManager.hideAllScreens();
        document.getElementById('permission-screen').classList.add('active');
        
        document.getElementById('grant-permission-btn').addEventListener('click', async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                stream.getTracks().forEach(track => track.stop()); // Stop the test stream
                
                // Return to previous screen
                if (window.authManager.token) {
                    window.authManager.showContactsScreen();
                } else {
                    window.authManager.showAuthScreen();
                }
            } catch (error) {
                console.error('Permission denied:', error);
                window.authManager.showToast('Microphone permission is required for audio calls', 'error');
            }
        });
    }

    async checkMicrophonePermission() {
        try {
            const result = await navigator.permissions.query({ name: 'microphone' });
            return result.state === 'granted';
        } catch (error) {
            // Fallback: try to access microphone
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ 
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true
                    }
                });
                stream.getTracks().forEach(track => track.stop());
                return true;
            } catch (e) {
                return false;
            }
        }
    }
    
    // Enhanced audio quality settings
    getAudioConstraints() {
        return {
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 44100,
                channelCount: 1,
                volume: 1.0
            },
            video: false
        };
    }
}

// Initialize WebRTC manager
window.webrtcManager = new WebRTCManager();