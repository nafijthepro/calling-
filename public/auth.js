class AuthManager {
    constructor() {
        this.token = localStorage.getItem('token');
        this.user = JSON.parse(localStorage.getItem('user') || 'null');
        this.initializeAuth();
    }

    initializeAuth() {
        // Auth tab switching
        document.getElementById('login-tab').addEventListener('click', () => {
            this.switchTab('login');
        });

        document.getElementById('register-tab').addEventListener('click', () => {
            this.switchTab('register');
        });

        // Form submissions
        document.getElementById('login-form').addEventListener('submit', (e) => {
            this.handleLogin(e);
        });

        document.getElementById('register-form').addEventListener('submit', (e) => {
            this.handleRegister(e);
        });

        // Logout
        document.getElementById('logout-btn').addEventListener('click', () => {
            this.logout();
        });

        // Check if already logged in
        if (this.token && this.user) {
            this.showContactsScreen();
        }
    }

    switchTab(tab) {
        // Update tab buttons
        document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
        document.getElementById(`${tab}-tab`).classList.add('active');

        // Update forms
        document.querySelectorAll('.auth-form').forEach(form => form.classList.remove('active'));
        document.getElementById(`${tab}-form`).classList.add('active');
    }

    async handleLogin(e) {
        e.preventDefault();
        
        const submitBtn = e.target.querySelector('button[type="submit"]');
        const originalText = submitBtn.innerHTML;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Logging in...';
        submitBtn.disabled = true;
        
        const username = document.getElementById('login-username').value.trim();
        const password = document.getElementById('login-password').value;

        if (!username || !password) {
            this.showToast('Please fill in all fields', 'error');
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
            return;
        }

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username: username.toLowerCase(), password })
            });

            const data = await response.json();

            if (response.ok) {
                this.token = data.token;
                this.user = data.user;
                localStorage.setItem('token', this.token);
                localStorage.setItem('user', JSON.stringify(this.user));
                
                this.showToast('Login successful!', 'success');
                
                // Clear form
                document.getElementById('login-form').reset();
                
                setTimeout(() => this.showContactsScreen(), 1000);
            } else {
                this.showToast(data.message || data.errors?.[0]?.msg || 'Login failed', 'error');
            }
        } catch (error) {
            console.error('Login error:', error);
            this.showToast('Network error. Please try again.', 'error');
        } finally {
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
        }
    }

    async handleRegister(e) {
        e.preventDefault();
        
        const submitBtn = e.target.querySelector('button[type="submit"]');
        const originalText = submitBtn.innerHTML;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating account...';
        submitBtn.disabled = true;
        
        const username = document.getElementById('register-username').value.trim();
        const password = document.getElementById('register-password').value;

        if (!username || !password) {
            this.showToast('Please fill in all fields', 'error');
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
            return;
        }

        try {
            const response = await fetch('/api/auth/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username: username.toLowerCase(), password })
            });

            const data = await response.json();

            if (response.ok) {
                this.token = data.token;
                this.user = data.user;
                localStorage.setItem('token', this.token);
                localStorage.setItem('user', JSON.stringify(this.user));
                
                this.showToast('Registration successful!', 'success');
                
                // Clear form
                document.getElementById('register-form').reset();
                
                setTimeout(() => this.showContactsScreen(), 1000);
            } else {
                this.showToast(data.message || data.errors?.[0]?.msg || 'Registration failed', 'error');
            }
        } catch (error) {
            console.error('Registration error:', error);
            this.showToast('Network error. Please try again.', 'error');
        } finally {
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
        }
    }

    async logout() {
        try {
            if (this.token) {
                await fetch('/api/auth/logout', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.token}`
                    }
                });
            }
        } catch (error) {
            console.error('Logout error:', error);
        }

        // Clear local storage
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        this.token = null;
        this.user = null;

        // Disconnect socket if connected
        if (window.socket) {
            window.socket.disconnect();
        }

        // Show auth screen
        this.showAuthScreen();
        this.showToast('Logged out successfully', 'success');
    }

    showAuthScreen() {
        this.hideAllScreens();
        document.getElementById('auth-screen').classList.add('active');
    }

    showContactsScreen() {
        this.hideAllScreens();
        document.getElementById('contacts-screen').classList.add('active');
        document.getElementById('username-display').textContent = this.user.username;
        
        // Initialize socket connection
        if (window.app) {
            window.app.initializeSocket();
        }
    }

    showCallScreen() {
        this.hideAllScreens();
        document.getElementById('call-screen').classList.add('active');
    }

    hideAllScreens() {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
    }

    showToast(message, type = 'info') {
        // Remove existing toasts
        document.querySelectorAll('.toast').forEach(toast => toast.remove());

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);

        // Auto remove after 4 seconds
        setTimeout(() => {
            if (toast.parentNode) {
                toast.style.animation = 'slideUp 0.3s ease forwards';
                setTimeout(() => {
                    if (toast.parentNode) {
                        toast.parentNode.removeChild(toast);
                    }
                }, 300);
            }
        }, 4000);
    }

    getAuthHeader() {
        return this.token ? { 'Authorization': `Bearer ${this.token}` } : {};
    }
    
    // Enhanced error handling
    handleNetworkError() {
        this.showToast('Network connection lost. Please check your internet.', 'error');
    }
    
    // Auto-retry connection
    async retryConnection(maxRetries = 3) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
                if (window.app && window.app.socket) {
                    window.app.initializeSocket();
                    return true;
                }
            } catch (error) {
                console.log(`Retry ${i + 1} failed:`, error);
            }
        }
        return false;
    }
}

// Initialize auth manager
window.authManager = new AuthManager();