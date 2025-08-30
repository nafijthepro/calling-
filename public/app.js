class AudioCallApp {
    constructor() {
        this.socket = null;
        this.callHistory = [];
        this.searchResults = [];
        this.currentView = 'history'; // 'history' or 'search'
        this.currentCall = null;
        this.ringtoneContext = null;
        this.searchTimeout = null;
        this.initialize();
    }

    initialize() {
        // Search functionality
        document.getElementById('search-input').addEventListener('input', (e) => {
            this.handleSearch(e.target.value);
        });

        // View toggle buttons
        document.getElementById('history-tab').addEventListener('click', () => {
            document.getElementById('search-input').value = '';
            this.switchToHistoryView();
        });

        document.getElementById('search-tab').addEventListener('click', () => {
            this.switchToSearchView();
            document.getElementById('search-input').focus();
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
            this.loadCallHistory();
        });

        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
        });

        this.socket.on('call-list', (history) => {
            this.callHistory = history;
            if (this.currentView === 'history') {
                this.renderCallHistory();
            }
        });

        this.socket.on('search-results', (results) => {
            console.log('Search results received:', results);
            this.searchResults = results.users || [];
            if (this.currentView === 'search') {
                this.renderSearchResults();
            }
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

    handleSearch(searchTerm) {
        clearTimeout(this.searchTimeout);
        
        if (searchTerm.trim().length === 0) {
            this.switchToHistoryView();
            document.getElementById('search-input').value = '';
            return;
        }

        if (searchTerm.trim().length < 2) {
            this.searchResults = [];
            if (this.currentView === 'search') {
                this.renderSearchResults();
            }
            return;
        }

        this.searchTimeout = setTimeout(() => {
            this.switchToSearchView();
            this.searchUsers(searchTerm.trim());
        }, 300);
    }

    switchToHistoryView() {
        this.currentView = 'history';
        document.getElementById('history-tab').classList.add('active');
        document.getElementById('search-tab').classList.remove('active');
        this.renderCallHistory();
    }

    switchToSearchView() {
        this.currentView = 'search';
        document.getElementById('search-tab').classList.add('active');
        document.getElementById('history-tab').classList.remove('active');
        this.renderSearchResults();
    }

    searchUsers(query) {
        this.showSearchLoading();
        if (this.socket) {
            console.log('Searching for users with query:', query);
            this.socket.emit('search-users', { query });
        }
    }

    loadCallHistory() {
        this.showHistoryLoading();
        if (this.socket) {
            this.socket.emit('get-call-list', { userId: window.authManager.user.id });
        }
    }

    showHistoryLoading() {
        const contactsList = document.getElementById('contacts-list');
        const noHistory = document.getElementById('no-history');
        const loadingSkeleton = document.getElementById('history-loading');
        
        noHistory.style.display = 'none';
        loadingSkeleton.style.display = 'block';
        contactsList.innerHTML = '';
        contactsList.appendChild(loadingSkeleton);
    }

    showSearchLoading() {
        const contactsList = document.getElementById('contacts-list');
        const noResults = document.getElementById('no-search-results');
        const loadingSkeleton = document.getElementById('search-loading');
        
        noResults.style.display = 'none';
        loadingSkeleton.style.display = 'none';
        contactsList.innerHTML = '';
        contactsList.appendChild(loadingSkeleton);
        loadingSkeleton.style.display = 'block';
    }

    renderCallHistory() {
        const contactsList = document.getElementById('contacts-list');
        const noHistory = document.getElementById('no-history');
        const loadingSkeleton = document.getElementById('history-loading');
        
        loadingSkeleton.style.display = 'none';

        if (this.callHistory.length === 0) {
            contactsList.innerHTML = '';
            noHistory.style.display = 'block';
            contactsList.appendChild(noHistory);
            return;
        }

        noHistory.style.display = 'none';
        contactsList.innerHTML = '';

        this.callHistory.forEach(contact => {
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

    renderSearchResults() {
        const contactsList = document.getElementById('contacts-list');
        const noResults = document.getElementById('no-search-results');
        const loadingSkeleton = document.getElementById('search-loading');
        
        loadingSkeleton.style.display = 'none';

        if (this.searchResults.length === 0) {
            contactsList.innerHTML = '';
            noResults.style.display = 'block';
            contactsList.appendChild(noResults);
            return;
        }

        noResults.style.display = 'none';
        contactsList.innerHTML = '';

        this.searchResults.forEach(user => {
            const contactItem = document.createElement('div');
            contactItem.className = 'contact-item fade-in';
            
            let statusText = '';
            if (user.online) {
                statusText = 'Online';
            } else if (user.lastSeen) {
                const lastSeenDate = new Date(user.lastSeen);
                const timeAgo = this.getTimeAgo(lastSeenDate);
                statusText = `Last seen ${timeAgo}`;
            } else {
                statusText = 'Offline';
            }
            
            contactItem.innerHTML = `
                <div class="contact-avatar">
                    <i class="fas fa-user"></i>
                    ${user.online ? '<div class="online-indicator"></div>' : ''}
                </div>
                <div class="contact-info">
                    <div class="contact-name">${user.username}</div>
                    <div class="contact-status">
                        <span class="status-dot ${user.online ? 'status-online' : 'status-offline'}"></span>
                        ${statusText}
                    </div>
                </div>
                <div class="contact-actions">
                    <button class="call-btn" data-contact-id="${user._id}" data-contact-name="${user.username}" ${!user.online ? 'disabled' : ''}>
                        <i class="fas fa-phone"></i>
                    </button>
                </div>
            `;

            const callBtn = contactItem.querySelector('.call-btn');
            callBtn.addEventListener('click', () => {
                if (user.online) {
                    this.initiateCall(user._id, user.username);
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
            calleeId: calleeId,
            calleeUsername: calleeName
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
        this.loadCallHistory();
    }

    updateUserOnlineStatus(userId, online) {
        // Update in call history
        const historyContact = this.callHistory.find(c => c._id === userId);
        if (historyContact) {
            historyContact.online = online;
            if (!online) {
                historyContact.lastSeen = new Date();
            }
        }

        // Update in search results
        const searchContact = this.searchResults.find(c => c._id === userId);
        if (searchContact) {
            searchContact.online = online;
            if (!online) {
                searchContact.lastSeen = new Date();
            }
        }

        // Re-render current view
        if (this.currentView === 'history') {
            this.renderCallHistory();
        } else if (this.currentView === 'search') {
            this.renderSearchResults();
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
        window.app.loadCallHistory();
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