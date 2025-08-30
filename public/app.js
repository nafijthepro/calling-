class AudioCallApp {
    constructor() {
        this.socket = null;
        this.contacts = [];
        this.filteredContacts = [];
        this.currentCall = null;
        this.ringtoneContext = null;
        this.initialize();
    }

    initialize() {
        // Search functionality
        document.getElementById('search-input').addEventListener('input', (e) => {
            this.filterContacts(e.target.value);
        });

        // Clear list button
        document.getElementById('clear-list-btn').addEventListener('click', () => {
            this.clearContactsList();
        });

        // Call controls
        document.getElementById('accept-btn').addEventListener('click', () => {
            this.acceptCall();
        });

        document.getElementById('decline-btn').addEventListener('click', () => {
            this.declineCall();
        });

        document.getElementById('end-call-btn').addEventListener('click', () => {
            this.endCall();
        });

        document.getElementById('mute-btn').addEventListener('click', () => {
            this.toggleMute();
        });

        // Check microphone permission on startup
        this.checkPermissions();
    }

    async checkPermissions() {
        const hasPermission = await window.webrtcManager.checkMicrophonePermission();
        if (!hasPermission && window.authManager.token) {
            window.webrtcManager.showPermissionScreen();
        }
    }

    initializeSocket() {
        if (!window.authManager.token) return;

        this.socket = io({
            auth: {
                token: window.authManager.token
            }
        });

        window.socket = this.socket;

        // Socket event listeners
        this.socket.on('connect', () => {
            console.log('Connected to server');
            this.socket.emit('register-socket', { userId: window.authManager.user.id });
            this.loadContacts();
        });

        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
        });

        this.socket.on('call-list', (contacts) => {
            this.contacts = contacts;
            this.filteredContacts = [...contacts];
            this.renderContacts();
        });

        this.socket.on('incoming-call', (data) => {
            this.handleIncomingCall(data);
        });

        this.socket.on('call-accepted', (data) => {
            this.handleCallAccepted(data);
        });

        this.socket.on('call-declined', () => {
            this.handleCallDeclined();
        });

        this.socket.on('call-failed', (data) => {
            window.authManager.showToast(data.message, 'error');
            this.returnToContacts();
        });

        this.socket.on('call-initiated', (data) => {
            this.currentCall = { type: 'outgoing', ...data };
            this.showCallScreen(data.calleeName, 'Calling...');
        });

        // WebRTC signaling events
        this.socket.on('offer', async (data) => {
            await window.webrtcManager.handleOffer(data.offer, data.sender);
        });

        this.socket.on('answer', async (data) => {
            await window.webrtcManager.handleAnswer(data.answer);
        });

        this.socket.on('ice-candidate', async (data) => {
            await window.webrtcManager.handleIceCandidate(data.candidate);
        });

        this.socket.on('call-ended', () => {
            this.endCall();
        });

        this.socket.on('user-online', (data) => {
            this.updateUserOnlineStatus(data.userId, true);
        });

        this.socket.on('user-offline', (data) => {
            this.updateUserOnlineStatus(data.userId, false);
        });
    }

    loadContacts() {
        this.showContactsLoading();
        if (this.socket) {
            this.socket.emit('get-call-list', { userId: window.authManager.user.id });
        }
    }

    showContactsLoading() {
        const contactsList = document.getElementById('contacts-list');
        const noContacts = document.getElementById('no-contacts');
        const loadingSkeleton = document.getElementById('contacts-loading');
        
        noContacts.style.display = 'none';
        loadingSkeleton.style.display = 'block';
        contactsList.innerHTML = '';
        contactsList.appendChild(loadingSkeleton);
    }

    renderContacts() {
        const contactsList = document.getElementById('contacts-list');
        const noContacts = document.getElementById('no-contacts');
        const loadingSkeleton = document.getElementById('contacts-loading');
        
        loadingSkeleton.style.display = 'none';

        if (this.filteredContacts.length === 0) {
            contactsList.innerHTML = '';
            noContacts.style.display = 'block';
            contactsList.appendChild(noContacts);
            return;
        }

        noContacts.style.display = 'none';
        contactsList.innerHTML = '';

        this.filteredContacts.forEach(contact => {
            const contactItem = document.createElement('div');
            contactItem.className = 'contact-item fade-in';
            
            const lastCalledDate = new Date(contact.lastCalled);
            const timeAgo = this.getTimeAgo(lastCalledDate);
            
            contactItem.innerHTML = `
                <div class="contact-avatar">
                    <i class="fas fa-user"></i>
                    ${contact.online ? '<div class="online-indicator"></div>' : ''}
                </div>
                <div class="contact-info">
                    <div class="contact-name">${contact.username}</div>
                    <div class="contact-status">
                        <span class="status-dot ${contact.online ? 'status-online' : 'status-offline'}"></span>
                        ${contact.online ? 'Online' : `Last seen ${timeAgo}`}
                    </div>
                </div>
                <div class="contact-actions">
                    <button class="call-btn" data-contact-id="${contact._id}" data-contact-name="${contact.username}" ${!contact.online ? 'disabled' : ''}>
                        <i class="fas fa-phone"></i>
                    </button>
                </div>
            `;

            const callBtn = contactItem.querySelector('.call-btn');
            callBtn.addEventListener('click', () => {
                if (contact.online) {
                    this.initiateCall(contact._id, contact.username);
                }
            });

            contactsList.appendChild(contactItem);
        });
    }

    getTimeAgo(date) {
        const now = new Date();
        const diffInSeconds = Math.floor((now - date) / 1000);
        
        if (diffInSeconds < 60) return 'just now';
        if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
        if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
        if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`;
        return date.toLocaleDateString();
    }

    filterContacts(searchTerm) {
        this.filteredContacts = this.contacts.filter(contact =>
            contact.username.toLowerCase().includes(searchTerm.toLowerCase())
        );
        this.renderContacts();
    }

    clearContactsList() {
        document.getElementById('search-input').value = '';
        this.contacts = [];
        this.filteredContacts = [];
        this.renderContacts();
        window.authManager.showToast('Contact list cleared', 'success');
    }

    async initiateCall(calleeId, calleeName) {
        // Check microphone permission
        const hasPermission = await window.webrtcManager.checkMicrophonePermission();
        if (!hasPermission) {
            window.webrtcManager.showPermissionScreen();
            return;
        }

        // Initialize WebRTC
        const initialized = await window.webrtcManager.initializeWebRTC(this.getIceServers());
        if (!initialized) {
            return;
        }

        this.currentCall = { type: 'outgoing', calleeId, calleeName };
        this.showCallScreen(calleeName, 'Calling...');

        // Emit call request
        this.socket.emit('call-user', {
            callerId: window.authManager.user.id,
            callerName: window.authManager.user.username,
            calleeId: calleeId
        });
    }

    async handleIncomingCall(data) {
        // Check microphone permission
        const hasPermission = await window.webrtcManager.checkMicrophonePermission();
        if (!hasPermission) {
            window.webrtcManager.showPermissionScreen();
            return;
        }

        this.currentCall = { 
            type: 'incoming', 
            callerId: data.callerId, 
            callerName: data.callerName,
            callerSocketId: data.callerSocketId
        };

        // Initialize WebRTC
        const initialized = await window.webrtcManager.initializeWebRTC(data.iceServers);
        if (!initialized) {
            return;
        }

        this.showCallScreen(data.callerName, 'Incoming call...');
        this.showIncomingCallControls();
        this.playRingtone();
    }

    async acceptCall() {
        this.stopRingtone();
        
        if (this.currentCall.type === 'incoming') {
            this.socket.emit('accept-call', {
                callerSocketId: this.currentCall.callerSocketId,
                calleeId: window.authManager.user.id,
                calleeName: window.authManager.user.username
            });
        }

        this.showActiveCallControls();
        document.getElementById('call-status-text').textContent = 'Connecting...';
        window.webrtcManager.isCallActive = true;
    }

    declineCall() {
        this.stopRingtone();
        
        if (this.currentCall.type === 'incoming') {
            this.socket.emit('decline-call', {
                callerSocketId: this.currentCall.callerSocketId
            });
        }

        this.returnToContacts();
    }

    endCall() {
        this.stopRingtone();
        window.webrtcManager.endCall();
        this.currentCall = null;
    }

    handleCallAccepted(data) {
        this.showActiveCallControls();
        document.getElementById('call-status-text').textContent = 'Connecting...';
        window.webrtcManager.isCallActive = true;
        window.webrtcManager.targetSocketId = data.calleeSocketId;
        window.webrtcManager.createOffer(data.calleeSocketId);
    }

    handleCallDeclined() {
        window.authManager.showToast('Call declined', 'error');
        this.returnToContacts();
    }

    toggleMute() {
        window.webrtcManager.toggleMute();
    }

    showCallScreen(partnerName, statusText) {
        window.authManager.showCallScreen();
        document.getElementById('call-partner-name').textContent = partnerName;
        document.getElementById('call-status-text').textContent = statusText;
        document.getElementById('call-timer').textContent = '00:00:00';
    }

    showIncomingCallControls() {
        document.getElementById('accept-btn').style.display = 'flex';
        document.getElementById('decline-btn').style.display = 'flex';
        document.getElementById('end-call-btn').style.display = 'none';
        document.getElementById('mute-btn').style.display = 'none';
    }

    showActiveCallControls() {
        document.getElementById('accept-btn').style.display = 'none';
        document.getElementById('decline-btn').style.display = 'none';
        document.getElementById('end-call-btn').style.display = 'flex';
        document.getElementById('mute-btn').style.display = 'flex';
    }

    playRingtone() {
        try {
            // Create a simple ringtone using Web Audio API
            this.ringtoneContext = new (window.AudioContext || window.webkitAudioContext)();
            this.playRingtoneLoop();
        } catch (error) {
            console.log('Could not play ringtone:', error);
        }
    }
    
    playRingtoneLoop() {
        if (!this.ringtoneContext) return;
        
        const oscillator = this.ringtoneContext.createOscillator();
        const gainNode = this.ringtoneContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(this.ringtoneContext.destination);
        
        oscillator.frequency.setValueAtTime(800, this.ringtoneContext.currentTime);
        oscillator.frequency.setValueAtTime(600, this.ringtoneContext.currentTime + 0.5);
        
        gainNode.gain.setValueAtTime(0, this.ringtoneContext.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.1, this.ringtoneContext.currentTime + 0.1);
        gainNode.gain.linearRampToValueAtTime(0, this.ringtoneContext.currentTime + 0.9);
        
        oscillator.start();
        oscillator.stop(this.ringtoneContext.currentTime + 1);
        
        // Loop the ringtone
        setTimeout(() => {
            if (this.ringtoneContext && this.currentCall) {
                this.playRingtoneLoop();
            }
        }, 1500);
    }

    stopRingtone() {
        if (this.ringtoneContext) {
            this.ringtoneContext.close();
            this.ringtoneContext = null;
        }
    }

    returnToContacts() {
        window.authManager.hideAllScreens();
        document.getElementById('contacts-screen').classList.add('active');
        this.loadContacts();
    }

    updateUserOnlineStatus(userId, online) {
        const contact = this.contacts.find(c => c._id === userId);
        if (contact) {
            contact.online = online;
            if (!online) {
                contact.lastSeen = new Date();
            }
            this.renderContacts();
        }
    }

    getIceServers() {
        return {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                {
                    urls: 'turn:openrelay.metered.ca:443',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                }
            ]
        };
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.app = new AudioCallApp();
});

// Handle page visibility changes
document.addEventListener('visibilitychange', () => {
    if (document.hidden && window.webrtcManager.isCallActive) {
        // Keep call active when app goes to background
        console.log('App went to background during call');
    } else if (!document.hidden && window.app && window.app.socket) {
        // Refresh contacts when app comes back to foreground
        window.app.loadContacts();
    }
});

// Handle beforeunload for cleanup
window.addEventListener('beforeunload', () => {
    if (window.webrtcManager.isCallActive) {
        window.webrtcManager.endCall();
    }
    if (window.socket) {
        window.socket.disconnect();
    }
    if (window.app && window.app.ringtoneContext) {
        window.app.ringtoneContext.close();
    }
});

// Handle online/offline status
window.addEventListener('online', () => {
    if (window.app && window.app.socket && !window.app.socket.connected) {
        window.app.initializeSocket();
    }
});

window.addEventListener('offline', () => {
    window.authManager.showToast('Connection lost. Reconnecting...', 'error');
});