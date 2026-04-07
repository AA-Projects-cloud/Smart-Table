import React, { useState, useEffect, useContext, createContext, useMemo, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider, useUser, useClerk, SignInButton, UserButton } from '@clerk/react';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import { createClient } from '@supabase/supabase-js';
import logo from './assets/logo.svg';
import './styles/index.css';

// ═══════════════════════════════════════════════════════════════════════════
// THEME CONTEXT - Light/Dark Theme Management
// ═══════════════════════════════════════════════════════════════════════════

const ThemeContext = createContext();

function ThemeProvider({ children }) {
    const [theme, setTheme] = useState(() => {
        const saved = localStorage.getItem('smarttable-theme');
        return saved || 'light';
    });

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('smarttable-theme', theme);
    }, [theme]);

    const toggleTheme = () => {
        setTheme(prev => prev === 'light' ? 'dark' : 'light');
    };

    return (
        <ThemeContext.Provider value={{ theme, toggleTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}

function useTheme() {
    const context = useContext(ThemeContext);
    if (!context) throw new Error('useTheme must be used within ThemeProvider');
    return context;
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTH CONTEXT - Role-based Authentication
// ═══════════════════════════════════════════════════════════════════════════

const AuthContext = createContext();

const ROLES = {
    STUDENT: 'student',
    FACULTY: 'faculty',
    HOD: 'hod'
};

const ROLE_CONFIG = {
    [ROLES.STUDENT]: {
        label: 'Student',
        color: 'cyan',
        dashboard: 'student'
    },
    [ROLES.FACULTY]: {
        label: 'Faculty',
        color: 'green',
        dashboard: 'faculty'
    },
    [ROLES.HOD]: {
        label: 'HOD',
        color: 'purple',
        dashboard: 'hod'
    }
};

function AuthProvider({ children }) {
    const { user: clerkUser, isLoaded } = useUser();
    const { signOut } = useClerk();
    
    const [user, setUser] = useState(null);

    useEffect(() => {
        if (isLoaded && clerkUser) {
            const email = clerkUser.primaryEmailAddress?.emailAddress?.toLowerCase() || '';
            let role = ROLES.STUDENT; // default fallback
            
            if (email.includes('+faculty') || email.includes('faculty@')) {
                role = ROLES.FACULTY;
            } else if (email.includes('+hod') || email.includes('hod@')) {
                role = ROLES.HOD;
            }
            
            setUser({
                id: clerkUser.id,
                email,
                role,
                name: clerkUser.fullName || getNameFromRole(role),
                loginTime: new Date().toISOString()
            });
        } else if (isLoaded && !clerkUser) {
            setUser(null);
        }
    }, [clerkUser, isLoaded]);

    const logout = async () => {
        await signOut();
        window.location.href = '/';
    };

    const getNameFromRole = (role) => {
        switch (role) {
            case ROLES.STUDENT: return 'Student';
            case ROLES.FACULTY: return 'Faculty Member';
            case ROLES.HOD: return 'HOD Admin';
            default: return 'User';
        }
    };

    return (
        <AuthContext.Provider value={{ 
            user, 
            logout, 
            isLoading: !isLoaded, 
            roleConfig: ROLE_CONFIG, 
            roles: ROLES 
        }}>
            {children}
        </AuthContext.Provider>
    );
}

function useAuth() {
    return useContext(AuthContext);
}

// ═══════════════════════════════════════════════════════════════════════════
// NOTIFICATION CONTEXT - Real-time Push Notifications
// ═══════════════════════════════════════════════════════════════════════════

const NotificationContext = createContext();

// Initialize Supabase client
const supabase = createClient(
    import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co',
    import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder'
);

function NotificationProvider({ children }) {
    const { user } = useAuth();
    const [notifications, setNotifications] = useState(() => {
        const saved = localStorage.getItem('smarttable-notifications');
        return saved ? JSON.parse(saved) : [];
    });
    const [unreadCount, setUnreadCount] = useState(0);
    const audioRef = useRef(null);

    // Initialize audio on first user interaction to bypass autoplay blocks
    useEffect(() => {
        const unlockAudio = () => {
            if (!audioRef.current) {
                audioRef.current = new Audio('https://cdn.pixabay.com/audio/2022/03/15/audio_78330a8760.mp3');
                audioRef.current.load();
                // Play and immediately pause to "unlock" the audio context
                audioRef.current.play().then(() => {
                    audioRef.current.pause();
                    audioRef.current.currentTime = 0;
                }).catch(() => {});
            }
            window.removeEventListener('click', unlockAudio);
        };
        window.addEventListener('click', unlockAudio);
        return () => window.removeEventListener('click', unlockAudio);
    }, []);

    const playNotificationSound = () => {
        if (audioRef.current) {
            audioRef.current.currentTime = 0;
            audioRef.current.play().catch(err => console.log("Audio play blocked:", err));
        }
    };

    useEffect(() => {
        setUnreadCount(notifications.filter(n => !n.read).length);
        localStorage.setItem('smarttable-notifications', JSON.stringify(notifications));
    }, [notifications]);

    // Request browser notification permission
    useEffect(() => {
        if ("Notification" in window && Notification.permission === "default") {
            Notification.requestPermission();
        }
    }, []);

    useEffect(() => {
        if (!user) return;

        console.log("Subscribing to notifications for role:", user.role);

        const channel = supabase
            .channel('public:notifications')
            .on('postgres_changes', { 
                event: 'INSERT', 
                schema: 'public', 
                table: 'notifications' 
            }, payload => {
                const { title, message, type, recipient_role } = payload.new;
                
                // Only show if role matches or is 'all'
                if (recipient_role === 'all' || recipient_role === user.role) {
                    const newNotif = {
                        id: payload.new.id,
                        title,
                        message,
                        type: type || 'info',
                        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        read: false,
                        date: new Date().toISOString()
                    };

                    setNotifications(prev => [newNotif, ...prev].slice(0, 50)); // Keep last 50
                    playNotificationSound();
                    
                    // Browser alert
                    if (Notification.permission === "granted") {
                        new Notification(title, { body: message });
                    }
                }
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [user]);

    const markAsRead = (id) => {
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    };

    const markAllAsRead = () => {
        setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    };

    const deleteNotification = (id) => {
        setNotifications(prev => prev.filter(n => n.id !== id));
    };

    const clearAll = () => setNotifications([]);

    const addNotification = (title, message, type = 'info') => {
        const newNotif = {
            id: Date.now(),
            title,
            message,
            type,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            read: false,
            date: new Date().toISOString()
        };
        setNotifications(prev => [newNotif, ...prev].slice(0, 50));
        playNotificationSound();
        if (Notification.permission === "granted") {
            new Notification(title, { body: message });
        }
    };

    return (
        <NotificationContext.Provider value={{ 
            notifications, 
            unreadCount, 
            markAsRead, 
            markAllAsRead, 
            deleteNotification,
            clearAll,
            addNotification
        }}>
            {children}
        </NotificationContext.Provider>
    );
}

function useNotifications() {
    const context = useContext(NotificationContext);
    if (!context) throw new Error('useNotifications must be used within NotificationProvider');
    return context;
}

// ═══════════════════════════════════════════════════════════════════════════
// ICONS COMPONENT - SVG Icons
// ═══════════════════════════════════════════════════════════════════════════

function Icon({ name, size = 20, className = '' }) {
    const icons = {
        dashboard: (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7"></rect>
                <rect x="14" y="3" width="7" height="7"></rect>
                <rect x="14" y="14" width="7" height="7"></rect>
                <rect x="3" y="14" width="7" height="7"></rect>
            </svg>
        ),
        timetable: (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line>
                <line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
        ),
        scheduler: (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
        ),
        analytics: (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="20" x2="18" y2="10"></line>
                <line x1="12" y1="20" x2="12" y2="4"></line>
                <line x1="6" y1="20" x2="6" y2="14"></line>
            </svg>
        ),
        faculty: (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
            </svg>
        ),
        rooms: (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                <polyline points="9 22 9 12 15 12 15 22"></polyline>
            </svg>
        ),
        subjects: (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
            </svg>
        ),
        settings: (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
        ),
        sun: (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5"></circle>
                <line x1="12" y1="1" x2="12" y2="3"></line>
                <line x1="12" y1="21" x2="12" y2="23"></line>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                <line x1="1" y1="12" x2="3" y2="12"></line>
                <line x1="21" y1="12" x2="23" y2="12"></line>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
            </svg>
        ),
        moon: (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
            </svg>
        ),
        logout: (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                <polyline points="16 17 21 12 16 7"></polyline>
                <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
        ),
        menu: (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="12" x2="21" y2="12"></line>
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
        ),
        x: (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
        ),
        user: (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
            </svg>
        ),
        clock: (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
        ),
        users: (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
            </svg>
        ),
        home: (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                <polyline points="9 22 9 12 15 12 15 22"></polyline>
            </svg>
        ),
        book: (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
            </svg>
        ),
        file: (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
        ),
        bell: (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
            </svg>
        ),
        trending: (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
                <polyline points="17 6 23 6 23 12"></polyline>
            </svg>
        ),
        check: (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
        ),
        alert: (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
        ),
        ai: (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"></path>
                <circle cx="8" cy="14" r="1"></circle>
                <circle cx="16" cy="14" r="1"></circle>
            </svg>
        ),
        cpu: (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect>
                <rect x="9" y="9" width="6" height="6"></rect>
                <line x1="9" y1="1" x2="9" y2="4"></line>
                <line x1="15" y1="1" x2="15" y2="4"></line>
                <line x1="9" y1="20" x2="9" y2="23"></line>
                <line x1="15" y1="20" x2="15" y2="23"></line>
                <line x1="20" y1="9" x2="23" y2="9"></line>
                <line x1="20" y1="14" x2="23" y2="14"></line>
                <line x1="1" y1="9" x2="4" y2="9"></line>
                <line x1="1" y1="14" x2="4" y2="14"></line>
            </svg>
        ),
        award: (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="7"></circle>
                <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"></polyline>
            </svg>
        ),
        calendar: (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line>
                <line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
        ),
        edit: (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
        ),
        upload: (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
        ),
        download: (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
        ),
        chevronDown: (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
        ),
        activity: (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
            </svg>
        ),
        building: (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect>
                <path d="M9 22v-4h6v4"></path>
                <path d="M8 6h.01"></path>
                <path d="M16 6h.01"></path>
                <path d="M12 6h.01"></path>
                <path d="M12 10h.01"></path>
                <path d="M12 14h.01"></path>
                <path d="M16 10h.01"></path>
                <path d="M16 14h.01"></path>
                <path d="M8 10h.01"></path>
                <path d="M8 14h.01"></path>
            </svg>
        ),
        briefcase: (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
            </svg>
        ),
        clipboard: (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
            </svg>
        )
    };

    return icons[name] || null;
}

// ═══════════════════════════════════════════════════════════════════════════
// LOGIN PAGE COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

function LoginPage() {
    return (
        <div className="login-page">
            <div className="login-card">
                <div className="login-logo">
                    <div className="login-logo-icon">
                        <img src={logo} alt="SmartTable logo" className="logo-image" />
                    </div>
                    <div className="login-logo-text">
                        <h1>SmartTable</h1>
                        <span>Intelligent Scheduling</span>
                    </div>
                </div>

                <h2 className="login-title">Welcome Back</h2>
                <p className="login-subtitle">Sign in securely with Clerk to access your dashboard</p>

                <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'center' }}>
                    <SignInButton mode="modal">
                        <button className="login-btn" style={{ width: '100%', padding: '1rem', cursor: 'pointer', borderRadius: '8px' }}>
                            Sign In
                        </button>
                    </SignInButton>
                </div>

                <div className="login-demo-info" style={{ marginTop: '2rem' }}>
                    <p>Role Assignment Rules:</p>
                    <code>Email contains 'faculty' → Faculty Dashboard</code>
                    <code>Email contains 'hod' → HOD Dashboard</code>
                    <code>Any other email → Student Dashboard</code>
                </div>
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// SIDEBAR COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

function Sidebar({ isOpen, onClose, currentPage, onNavigate, role }) {
    const { roles } = useAuth();

    const studentLinks = [
        { id: 'dashboard', label: 'Dashboard', icon: 'home' },
        { id: 'timetable', label: 'Timetable', icon: 'calendar' },
        { id: 'updates', label: 'Updates', icon: 'bell' },
        { id: 'mcq', label: 'MCQ Test', icon: 'clipboard' },
        { id: 'revision', label: 'Revision', icon: 'book' },
        { id: 'progress', label: 'Progress', icon: 'trending' },
        { id: 'settings', label: 'Settings', icon: 'settings' }
    ];

    const facultyLinks = [
        { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
        { id: 'timetable', label: 'Timetable', icon: 'timetable' },
        { id: 'scheduler', label: 'Auto Scheduler', icon: 'scheduler' },
        { id: 'rooms', label: 'Rooms', icon: 'rooms' },
        { id: 'subjects', label: 'Subjects', icon: 'subjects' },
        { id: 'attendance', label: 'Attendance', icon: 'check' },
        { id: 'settings', label: 'Settings', icon: 'settings' }
    ];

    const hodLinks = [
        ...facultyLinks.slice(0, 3),
        { id: 'analytics', label: 'Institute Analytics', icon: 'analytics' },
        { id: 'workload', label: 'Faculty Workload', icon: 'users' },
        { id: 'subjectAssignment', label: 'Subject Assignment', icon: 'clipboard' },
        { id: 'roomControl', label: 'Room Control', icon: 'building' },
        { id: 'conflicts', label: 'Conflict Approval', icon: 'alert' },
        { id: 'reports', label: 'Reports', icon: 'file' },
        ...facultyLinks.slice(3)
    ];

    const links = role === roles.STUDENT
        ? studentLinks
        : role === roles.HOD
            ? hodLinks
            : facultyLinks;

    return (
        <>
            <div
                className={`sidebar-overlay ${isOpen ? 'visible' : ''}`}
                onClick={onClose}
            />
            <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
                <div className="sidebar-header">
                    <div className="sidebar-logo">
                        <img src={logo} alt="SmartTable logo" className="logo-image" />
                    </div>
                    <div className="sidebar-brand">
                        <h2>SmartTable</h2>
                        <span>Intelligent Scheduling</span>
                    </div>
                </div>

                <nav className="sidebar-nav">
                    {links.map((link, index) => (
                        <button
                            key={link.id}
                            className={`sidebar-link ${currentPage === link.id ? 'active' : ''}`}
                            onClick={() => {
                                onNavigate(link.id);
                                onClose();
                            }}
                        >
                            <Icon name={link.icon} size={20} />
                            {link.label}
                        </button>
                    ))}
                </nav>

                <div className="sidebar-footer">
                    <div className="ai-status">
                        <span className="ai-status-dot"></span>
                        AI Active
                    </div>
                </div>
            </aside>
        </>
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// SEMESTER-WISE SYLLABUS DATA (B.Tech Computer Science)
// ═══════════════════════════════════════════════════════════════════════════

const SEMESTER_DATA = {
    'Semester 1': {
        label: '1st Year – Semester 1',
        subjects: [
            { id: 'sub-1', code: 'MA101', subject: 'Engineering Mathematics I', type: 'lecture', faculty: 'Dr. Anjali Sharma', room: 'A-101', student: 'Batch A – 60 students', resources: [], assignments: [] },
            { id: 'sub-2', code: 'PH101', subject: 'Engineering Physics', type: 'lecture', faculty: 'Dr. Rajesh Gupta', room: 'A-102', student: 'Batch A – 60 students', resources: [], assignments: [] },
            { id: 'sub-3', code: 'CS101', subject: 'Programming in C', type: 'lab', faculty: 'Ms. Priya Verma', room: 'Lab-1', student: 'Batch A – 30 students', resources: [], assignments: [] },
            { id: 'sub-4', code: 'ME101', subject: 'Engineering Graphics', type: 'tutorial', faculty: 'Dr. Suresh Kumar', room: 'B-201', student: 'Batch A – 30 students', resources: [], assignments: [] },
            { id: 'sub-5', code: 'HU101', subject: 'English Communication', type: 'lecture', faculty: 'Ms. Neha Singh', room: 'B-101', student: 'Batch A – 60 students', resources: [], assignments: [] },
            { id: 'sub-6', code: 'CH101', subject: 'Engineering Chemistry', type: 'lecture', faculty: 'Dr. Kavita Mishra', room: 'A-103', student: 'Batch A – 60 students', resources: [], assignments: [] },
        ],
        schedule: [
            { time: '09:00 - 10:00', days: [
                { subject: 'Engineering Mathematics I', type: 'lecture', faculty: 'Dr. Anjali Sharma', room: 'A-101', student: 'Batch A – 60 students' },
                { subject: '', type: 'empty' },
                { subject: 'Engineering Mathematics I', type: 'lecture', faculty: 'Dr. Anjali Sharma', room: 'A-101', student: 'Batch A – 60 students' },
                { subject: '', type: 'empty' },
                { subject: 'Engineering Physics', type: 'lecture', faculty: 'Dr. Rajesh Gupta', room: 'A-102', student: 'Batch A – 60 students' },
            ]},
            { time: '10:00 - 11:00', days: [
                { subject: 'Engineering Physics', type: 'lecture', faculty: 'Dr. Rajesh Gupta', room: 'A-102', student: 'Batch A – 60 students' },
                { subject: 'Programming in C', type: 'lab', faculty: 'Ms. Priya Verma', room: 'Lab-1', student: 'Batch A – 30 students' },
                { subject: '', type: 'empty' },
                { subject: 'English Communication', type: 'lecture', faculty: 'Ms. Neha Singh', room: 'B-101', student: 'Batch A – 60 students' },
                { subject: '', type: 'empty' },
            ]},
            { time: '11:00 - 12:00', days: [
                { subject: 'English Communication', type: 'lecture', faculty: 'Ms. Neha Singh', room: 'B-101', student: 'Batch A – 60 students' },
                { subject: 'Engineering Chemistry', type: 'lecture', faculty: 'Dr. Kavita Mishra', room: 'A-103', student: 'Batch A – 60 students' },
                { subject: 'Programming in C', type: 'lab', faculty: 'Ms. Priya Verma', room: 'Lab-1', student: 'Batch A – 30 students' },
                { subject: 'Engineering Mathematics I', type: 'tutorial', faculty: 'Dr. Anjali Sharma', room: 'B-201', student: 'Batch A – 30 students' },
                { subject: 'Engineering Chemistry', type: 'lecture', faculty: 'Dr. Kavita Mishra', room: 'A-103', student: 'Batch A – 60 students' },
            ]},
            { time: '12:00 - 13:00', days: [{ subject: '', type: 'empty' },{ subject: '', type: 'empty' },{ subject: '', type: 'empty' },{ subject: '', type: 'empty' },{ subject: '', type: 'empty' }] },
            { time: '14:00 - 15:00', days: [
                { subject: 'Engineering Graphics', type: 'tutorial', faculty: 'Dr. Suresh Kumar', room: 'B-201', student: 'Batch A – 30 students' },
                { subject: 'Engineering Mathematics I', type: 'tutorial', faculty: 'Dr. Anjali Sharma', room: 'B-202', student: 'Batch A – 30 students' },
                { subject: 'Engineering Chemistry', type: 'lab', faculty: 'Dr. Kavita Mishra', room: 'Lab-2', student: 'Batch A – 30 students' },
                { subject: 'Programming in C', type: 'lecture', faculty: 'Ms. Priya Verma', room: 'A-104', student: 'Batch A – 60 students' },
                { subject: 'Engineering Graphics', type: 'tutorial', faculty: 'Dr. Suresh Kumar', room: 'B-201', student: 'Batch A – 30 students' },
            ]},
            { time: '15:00 - 16:00', days: [
                { subject: '', type: 'empty' },
                { subject: 'Engineering Physics', type: 'lab', faculty: 'Dr. Rajesh Gupta', room: 'Lab-2', student: 'Batch A – 30 students' },
                { subject: 'English Communication', type: 'tutorial', faculty: 'Ms. Neha Singh', room: 'B-202', student: 'Batch A – 30 students' },
                { subject: '', type: 'empty' },
                { subject: '', type: 'empty' },
            ]},
        ],
        todayClasses: [
            { time: '09:00', subject: 'Engineering Mathematics I', faculty: 'Dr. Anjali Sharma', room: 'A-101', hour: 9, minute: 0 },
            { time: '10:00', subject: 'Engineering Physics', faculty: 'Dr. Rajesh Gupta', room: 'A-102', hour: 10, minute: 0 },
            { time: '14:00', subject: 'Engineering Graphics', faculty: 'Dr. Suresh Kumar', room: 'B-201', hour: 14, minute: 0 },
            { time: '15:00', subject: 'Programming in C (Lab)', faculty: 'Ms. Priya Verma', room: 'Lab-1', hour: 15, minute: 0 },
        ],
    },
    'Semester 2': {
        label: '1st Year – Semester 2',
        subjects: [
            { id: 'sub-1', code: 'MA201', subject: 'Engineering Mathematics II', type: 'lecture', faculty: 'Dr. Anjali Sharma', room: 'A-101', student: 'Batch A – 60 students', resources: [], assignments: [] },
            { id: 'sub-2', code: 'CS201', subject: 'Data Structures', type: 'lecture', faculty: 'Ms. Priya Verma', room: 'A-102', student: 'Batch A – 60 students', resources: [], assignments: [] },
            { id: 'sub-3', code: 'CS202', subject: 'OOP with Java', type: 'lab', faculty: 'Dr. Arun Patel', room: 'Lab-1', student: 'Batch A – 30 students', resources: [], assignments: [] },
            { id: 'sub-4', code: 'EC201', subject: 'Digital Electronics', type: 'lecture', faculty: 'Dr. Meena Rao', room: 'A-103', student: 'Batch A – 60 students', resources: [], assignments: [] },
            { id: 'sub-5', code: 'AS201', subject: 'Environmental Studies', type: 'lecture', faculty: 'Dr. Ritu Joshi', room: 'B-101', student: 'Batch A – 60 students', resources: [], assignments: [] },
            { id: 'sub-6', code: 'BS201', subject: 'Basic Sciences Lab', type: 'lab', faculty: 'Dr. Rajesh Gupta', room: 'Lab-2', student: 'Batch A – 30 students', resources: [], assignments: [] },
        ],
        schedule: [
            { time: '09:00 - 10:00', days: [
                { subject: 'Engineering Mathematics II', type: 'lecture', faculty: 'Dr. Anjali Sharma', room: 'A-101', student: 'Batch A – 60 students' },
                { subject: '', type: 'empty' },
                { subject: 'Data Structures', type: 'lecture', faculty: 'Ms. Priya Verma', room: 'A-102', student: 'Batch A – 60 students' },
                { subject: '', type: 'empty' },
                { subject: 'OOP with Java', type: 'lab', faculty: 'Dr. Arun Patel', room: 'Lab-1', student: 'Batch A – 30 students' },
            ]},
            { time: '10:00 - 11:00', days: [
                { subject: 'Data Structures', type: 'lecture', faculty: 'Ms. Priya Verma', room: 'A-102', student: 'Batch A – 60 students' },
                { subject: 'Digital Electronics', type: 'lecture', faculty: 'Dr. Meena Rao', room: 'A-103', student: 'Batch A – 60 students' },
                { subject: '', type: 'empty' },
                { subject: 'Engineering Mathematics II', type: 'tutorial', faculty: 'Dr. Anjali Sharma', room: 'B-202', student: 'Batch A – 30 students' },
                { subject: '', type: 'empty' },
            ]},
            { time: '11:00 - 12:00', days: [
                { subject: 'Digital Electronics', type: 'lecture', faculty: 'Dr. Meena Rao', room: 'A-103', student: 'Batch A – 60 students' },
                { subject: 'Engineering Mathematics II', type: 'lecture', faculty: 'Dr. Anjali Sharma', room: 'A-101', student: 'Batch A – 60 students' },
                { subject: 'OOP with Java', type: 'lab', faculty: 'Dr. Arun Patel', room: 'Lab-1', student: 'Batch A – 30 students' },
                { subject: 'Digital Electronics', type: 'tutorial', faculty: 'Dr. Meena Rao', room: 'B-201', student: 'Batch A – 30 students' },
                { subject: 'Environmental Studies', type: 'lecture', faculty: 'Dr. Ritu Joshi', room: 'B-101', student: 'Batch A – 60 students' },
            ]},
            { time: '12:00 - 13:00', days: [{ subject: '', type: 'empty' },{ subject: '', type: 'empty' },{ subject: '', type: 'empty' },{ subject: '', type: 'empty' },{ subject: '', type: 'empty' }] },
            { time: '14:00 - 15:00', days: [
                { subject: 'Environmental Studies', type: 'lecture', faculty: 'Dr. Ritu Joshi', room: 'B-101', student: 'Batch A – 60 students' },
                { subject: 'Basic Sciences Lab', type: 'lab', faculty: 'Dr. Rajesh Gupta', room: 'Lab-2', student: 'Batch A – 30 students' },
                { subject: 'Environmental Studies', type: 'tutorial', faculty: 'Dr. Ritu Joshi', room: 'B-202', student: 'Batch A – 30 students' },
                { subject: 'Data Structures', type: 'lab', faculty: 'Ms. Priya Verma', room: 'Lab-1', student: 'Batch A – 30 students' },
                { subject: 'Data Structures', type: 'lecture', faculty: 'Ms. Priya Verma', room: 'A-102', student: 'Batch A – 60 students' },
            ]},
            { time: '15:00 - 16:00', days: [
                { subject: 'OOP with Java', type: 'lecture', faculty: 'Dr. Arun Patel', room: 'A-104', student: 'Batch A – 60 students' },
                { subject: '', type: 'empty' },
                { subject: 'Digital Electronics', type: 'lab', faculty: 'Dr. Meena Rao', room: 'Lab-2', student: 'Batch A – 30 students' },
                { subject: '', type: 'empty' },
                { subject: '', type: 'empty' },
            ]},
        ],
        todayClasses: [
            { time: '09:00', subject: 'Engineering Mathematics II', faculty: 'Dr. Anjali Sharma', room: 'A-101', hour: 9, minute: 0 },
            { time: '10:00', subject: 'Data Structures', faculty: 'Ms. Priya Verma', room: 'A-102', hour: 10, minute: 0 },
            { time: '14:00', subject: 'OOP with Java (Lab)', faculty: 'Dr. Arun Patel', room: 'Lab-1', hour: 14, minute: 0 },
            { time: '15:00', subject: 'Environmental Studies', faculty: 'Dr. Ritu Joshi', room: 'B-101', hour: 15, minute: 0 },
        ],
    },
    'Semester 3': {
        label: '2nd Year – Semester 3',
        subjects: [
            { id: 'sub-1', code: 'CS301', subject: 'Data Structures & Algorithms', type: 'lecture', faculty: 'Dr. Sarah Johnson', room: 'A-101', student: 'CS301 – 55 students', resources: [], assignments: [] },
            { id: 'sub-2', code: 'CS302', subject: 'Discrete Mathematics', type: 'lecture', faculty: 'Dr. Rachel Park', room: 'B-202', student: 'CS301 – 55 students', resources: [], assignments: [] },
            { id: 'sub-3', code: 'CS303', subject: 'Database Management Systems', type: 'lecture', faculty: 'Dr. Sarah Johnson', room: 'A-102', student: 'CS302 – 52 students', resources: [], assignments: [] },
            { id: 'sub-4', code: 'CS304', subject: 'Operating Systems', type: 'lecture', faculty: 'Dr. Robert Kim', room: 'A-103', student: 'CS301 – 55 students', resources: [], assignments: [] },
            { id: 'sub-5', code: 'CS305', subject: 'Software Engineering', type: 'tutorial', faculty: 'Ms. Lisa Wong', room: 'B-101', student: 'CS303 – 48 students', resources: [], assignments: [] },
            { id: 'sub-6', code: 'CS306', subject: 'Computer Organization', type: 'lecture', faculty: 'Prof. Michael Chen', room: 'A-104', student: 'CS401 – 40 students', resources: [], assignments: [] },
        ],
        schedule: [
            { time: '09:00 - 10:00', days: [
                { subject: 'Data Structures & Algorithms', type: 'lecture', faculty: 'Dr. Sarah Johnson', room: 'A-101', student: 'CS301 – 55 students' },
                { subject: 'Database Management Systems', type: 'lecture', faculty: 'Dr. Sarah Johnson', room: 'A-102', student: 'CS302 – 52 students' },
                { subject: 'Data Structures & Algorithms', type: 'lecture', faculty: 'Dr. Sarah Johnson', room: 'A-101', student: 'CS301 – 55 students' },
                { subject: '', type: 'empty' },
                { subject: 'Operating Systems', type: 'lab', faculty: 'Dr. Robert Kim', room: 'Lab-2', student: 'CS301 – 30 students' },
            ]},
            { time: '10:00 - 11:00', days: [
                { subject: '', type: 'empty' },
                { subject: 'Operating Systems', type: 'lecture', faculty: 'Dr. Robert Kim', room: 'A-103', student: 'CS301 – 55 students' },
                { subject: '', type: 'empty' },
                { subject: 'Software Engineering', type: 'tutorial', faculty: 'Ms. Lisa Wong', room: 'B-201', student: 'CS303 – 25 students' },
                { subject: '', type: 'empty' },
            ]},
            { time: '11:00 - 12:00', days: [
                { subject: 'Operating Systems', type: 'lecture', faculty: 'Dr. Robert Kim', room: 'A-103', student: 'CS301 – 55 students' },
                { subject: 'Computer Organization', type: 'lecture', faculty: 'Prof. Michael Chen', room: 'A-104', student: 'CS401 – 40 students' },
                { subject: 'Operating Systems', type: 'lab', faculty: 'Dr. Robert Kim', room: 'Lab-2', student: 'CS301 – 30 students' },
                { subject: 'Database Management Systems', type: 'lecture', faculty: 'Dr. Sarah Johnson', room: 'A-102', student: 'CS302 – 52 students' },
                { subject: '', type: 'empty' },
            ]},
            { time: '12:00 - 13:00', days: [{ subject: '', type: 'empty' },{ subject: '', type: 'empty' },{ subject: '', type: 'empty' },{ subject: '', type: 'empty' },{ subject: '', type: 'empty' }] },
            { time: '14:00 - 15:00', days: [
                { subject: 'Discrete Mathematics', type: 'lecture', faculty: 'Dr. Rachel Park', room: 'B-202', student: 'CS301 – 55 students' },
                { subject: 'Data Structures & Algorithms', type: 'tutorial', faculty: 'Dr. Sarah Johnson', room: 'B-202', student: 'CS301 – 25 students' },
                { subject: 'Database Management Systems', type: 'lab', faculty: 'Dr. Sarah Johnson', room: 'Lab-1', student: 'CS302 – 25 students' },
                { subject: 'Computer Organization', type: 'lecture', faculty: 'Prof. Michael Chen', room: 'A-104', student: 'CS401 – 40 students' },
                { subject: 'Software Engineering', type: 'lecture', faculty: 'Ms. Lisa Wong', room: 'B-101', student: 'CS303 – 48 students' },
            ]},
            { time: '15:00 - 16:00', days: [
                { subject: '', type: 'empty' },
                { subject: 'Discrete Mathematics', type: 'tutorial', faculty: 'Dr. Rachel Park', room: 'B-202', student: 'CS301 – 25 students' },
                { subject: 'Software Engineering', type: 'lecture', faculty: 'Ms. Lisa Wong', room: 'B-101', student: 'CS303 – 48 students' },
                { subject: '', type: 'empty' },
                { subject: '', type: 'empty' },
            ]},
        ],
        todayClasses: [
            { time: '09:00', subject: 'Data Structures & Algorithms', faculty: 'Dr. Sarah Johnson', room: 'A-101', hour: 9, minute: 0 },
            { time: '11:00', subject: 'Operating Systems', faculty: 'Dr. Robert Kim', room: 'A-103', hour: 11, minute: 0 },
            { time: '14:00', subject: 'Discrete Mathematics', faculty: 'Dr. Rachel Park', room: 'B-202', hour: 14, minute: 0 },
            { time: '15:00', subject: 'Software Engineering', faculty: 'Ms. Lisa Wong', room: 'B-101', hour: 15, minute: 0 },
        ],
    },
    'Semester 4': {
        label: '2nd Year – Semester 4',
        subjects: [
            { id: 'sub-1', code: 'CS401', subject: 'Theory of Computation', type: 'lecture', faculty: 'Dr. Rachel Park', room: 'A-101', student: 'CS401 – 55 students', resources: [], assignments: [] },
            { id: 'sub-2', code: 'CS402', subject: 'Computer Networks', type: 'lecture', faculty: 'Prof. Michael Chen', room: 'A-104', student: 'CS401 – 55 students', resources: [], assignments: [] },
            { id: 'sub-3', code: 'CS403', subject: 'Design of Algorithms', type: 'lecture', faculty: 'Dr. Sarah Johnson', room: 'A-102', student: 'CS402 – 52 students', resources: [], assignments: [] },
            { id: 'sub-4', code: 'CS404', subject: 'Microprocessors & Interfacing', type: 'lab', faculty: 'Dr. Robert Kim', room: 'Lab-3', student: 'CS401 – 30 students', resources: [], assignments: [] },
            { id: 'sub-5', code: 'CS405', subject: 'Web Technologies', type: 'lecture', faculty: 'Ms. Lisa Wong', room: 'B-101', student: 'CS403 – 48 students', resources: [], assignments: [] },
            { id: 'sub-6', code: 'MA401', subject: 'Probability & Statistics', type: 'lecture', faculty: 'Dr. Anjali Sharma', room: 'B-202', student: 'CS401 – 55 students', resources: [], assignments: [] },
        ],
        schedule: [
            { time: '09:00 - 10:00', days: [
                { subject: 'Theory of Computation', type: 'lecture', faculty: 'Dr. Rachel Park', room: 'A-101', student: 'CS401 – 55 students' },
                { subject: 'Computer Networks', type: 'lecture', faculty: 'Prof. Michael Chen', room: 'A-104', student: 'CS401 – 55 students' },
                { subject: 'Theory of Computation', type: 'lecture', faculty: 'Dr. Rachel Park', room: 'A-101', student: 'CS401 – 55 students' },
                { subject: '', type: 'empty' },
                { subject: 'Design of Algorithms', type: 'lab', faculty: 'Dr. Sarah Johnson', room: 'Lab-1', student: 'CS402 – 25 students' },
            ]},
            { time: '10:00 - 11:00', days: [
                { subject: '', type: 'empty' },
                { subject: 'Design of Algorithms', type: 'lecture', faculty: 'Dr. Sarah Johnson', room: 'A-102', student: 'CS402 – 52 students' },
                { subject: '', type: 'empty' },
                { subject: 'Web Technologies', type: 'tutorial', faculty: 'Ms. Lisa Wong', room: 'B-201', student: 'CS403 – 25 students' },
                { subject: '', type: 'empty' },
            ]},
            { time: '11:00 - 12:00', days: [
                { subject: 'Probability & Statistics', type: 'lecture', faculty: 'Dr. Anjali Sharma', room: 'B-202', student: 'CS401 – 55 students' },
                { subject: 'Microprocessors & Interfacing', type: 'lab', faculty: 'Dr. Robert Kim', room: 'Lab-3', student: 'CS401 – 30 students' },
                { subject: 'Computer Networks', type: 'lab', faculty: 'Prof. Michael Chen', room: 'Lab-2', student: 'CS401 – 30 students' },
                { subject: 'Design of Algorithms', type: 'lecture', faculty: 'Dr. Sarah Johnson', room: 'A-102', student: 'CS402 – 52 students' },
                { subject: '', type: 'empty' },
            ]},
            { time: '12:00 - 13:00', days: [{ subject: '', type: 'empty' },{ subject: '', type: 'empty' },{ subject: '', type: 'empty' },{ subject: '', type: 'empty' },{ subject: '', type: 'empty' }] },
            { time: '14:00 - 15:00', days: [
                { subject: 'Web Technologies', type: 'lecture', faculty: 'Ms. Lisa Wong', room: 'B-101', student: 'CS403 – 48 students' },
                { subject: 'Theory of Computation', type: 'tutorial', faculty: 'Dr. Rachel Park', room: 'B-202', student: 'CS401 – 25 students' },
                { subject: 'Web Technologies', type: 'lab', faculty: 'Ms. Lisa Wong', room: 'Lab-1', student: 'CS403 – 25 students' },
                { subject: 'Computer Networks', type: 'lecture', faculty: 'Prof. Michael Chen', room: 'A-104', student: 'CS401 – 55 students' },
                { subject: 'Probability & Statistics', type: 'lecture', faculty: 'Dr. Anjali Sharma', room: 'B-202', student: 'CS401 – 55 students' },
            ]},
            { time: '15:00 - 16:00', days: [
                { subject: '', type: 'empty' },
                { subject: 'Probability & Statistics', type: 'tutorial', faculty: 'Dr. Anjali Sharma', room: 'B-202', student: 'CS401 – 25 students' },
                { subject: 'Microprocessors & Interfacing', type: 'lecture', faculty: 'Dr. Robert Kim', room: 'A-103', student: 'CS401 – 55 students' },
                { subject: '', type: 'empty' },
                { subject: '', type: 'empty' },
            ]},
        ],
        todayClasses: [
            { time: '09:00', subject: 'Theory of Computation', faculty: 'Dr. Rachel Park', room: 'A-101', hour: 9, minute: 0 },
            { time: '11:00', subject: 'Probability & Statistics', faculty: 'Dr. Anjali Sharma', room: 'B-202', hour: 11, minute: 0 },
            { time: '14:00', subject: 'Web Technologies', faculty: 'Ms. Lisa Wong', room: 'B-101', hour: 14, minute: 0 },
            { time: '15:00', subject: 'Microprocessors & Interfacing (Lab)', faculty: 'Dr. Robert Kim', room: 'Lab-3', hour: 15, minute: 0 },
        ],
    },
    'Semester 5': {
        label: '3rd Year – Semester 5',
        subjects: [
            { id: 'sub-1', code: 'CS501', subject: 'Compiler Design', type: 'lecture', faculty: 'Dr. Robert Kim', room: 'A-103', student: 'CS501 – 52 students', resources: [], assignments: [] },
            { id: 'sub-2', code: 'CS502', subject: 'Artificial Intelligence', type: 'lecture', faculty: 'Prof. Michael Chen', room: 'A-104', student: 'CS501 – 52 students', resources: [], assignments: [] },
            { id: 'sub-3', code: 'CS503', subject: 'Computer Graphics', type: 'lab', faculty: 'Ms. Lisa Wong', room: 'Lab-3', student: 'CS501 – 25 students', resources: [], assignments: [] },
            { id: 'sub-4', code: 'CS504', subject: 'Information Security', type: 'lecture', faculty: 'Dr. Sarah Johnson', room: 'A-101', student: 'CS501 – 52 students', resources: [], assignments: [] },
            { id: 'sub-5', code: 'CS505', subject: 'Machine Learning', type: 'lecture', faculty: 'Prof. Michael Chen', room: 'A-104', student: 'CS502 – 45 students', resources: [], assignments: [] },
            { id: 'sub-6', code: 'CS506', subject: 'Mobile App Development', type: 'lab', faculty: 'Ms. Lisa Wong', room: 'Lab-1', student: 'CS501 – 25 students', resources: [], assignments: [] },
        ],
        schedule: [
            { time: '09:00 - 10:00', days: [
                { subject: 'Compiler Design', type: 'lecture', faculty: 'Dr. Robert Kim', room: 'A-103', student: 'CS501 – 52 students' },
                { subject: 'Artificial Intelligence', type: 'lecture', faculty: 'Prof. Michael Chen', room: 'A-104', student: 'CS501 – 52 students' },
                { subject: 'Compiler Design', type: 'lecture', faculty: 'Dr. Robert Kim', room: 'A-103', student: 'CS501 – 52 students' },
                { subject: '', type: 'empty' },
                { subject: 'Machine Learning', type: 'lab', faculty: 'Prof. Michael Chen', room: 'Lab-3', student: 'CS502 – 25 students' },
            ]},
            { time: '10:00 - 11:00', days: [
                { subject: '', type: 'empty' },
                { subject: 'Machine Learning', type: 'lecture', faculty: 'Prof. Michael Chen', room: 'A-104', student: 'CS502 – 45 students' },
                { subject: '', type: 'empty' },
                { subject: 'Mobile App Development', type: 'lab', faculty: 'Ms. Lisa Wong', room: 'Lab-1', student: 'CS501 – 25 students' },
                { subject: '', type: 'empty' },
            ]},
            { time: '11:00 - 12:00', days: [
                { subject: 'Artificial Intelligence', type: 'lecture', faculty: 'Prof. Michael Chen', room: 'A-104', student: 'CS501 – 52 students' },
                { subject: 'Information Security', type: 'lecture', faculty: 'Dr. Sarah Johnson', room: 'A-101', student: 'CS501 – 52 students' },
                { subject: 'Computer Graphics', type: 'lab', faculty: 'Ms. Lisa Wong', room: 'Lab-3', student: 'CS501 – 25 students' },
                { subject: 'Machine Learning', type: 'lecture', faculty: 'Prof. Michael Chen', room: 'A-104', student: 'CS502 – 45 students' },
                { subject: '', type: 'empty' },
            ]},
            { time: '12:00 - 13:00', days: [{ subject: '', type: 'empty' },{ subject: '', type: 'empty' },{ subject: '', type: 'empty' },{ subject: '', type: 'empty' },{ subject: '', type: 'empty' }] },
            { time: '14:00 - 15:00', days: [
                { subject: 'Information Security', type: 'lecture', faculty: 'Dr. Sarah Johnson', room: 'A-101', student: 'CS501 – 52 students' },
                { subject: 'Compiler Design', type: 'tutorial', faculty: 'Dr. Robert Kim', room: 'B-202', student: 'CS501 – 25 students' },
                { subject: 'Artificial Intelligence', type: 'lab', faculty: 'Prof. Michael Chen', room: 'Lab-2', student: 'CS501 – 25 students' },
                { subject: 'Compiler Design', type: 'lecture', faculty: 'Dr. Robert Kim', room: 'A-103', student: 'CS501 – 52 students' },
                { subject: 'Information Security', type: 'tutorial', faculty: 'Dr. Sarah Johnson', room: 'B-201', student: 'CS501 – 25 students' },
            ]},
            { time: '15:00 - 16:00', days: [
                { subject: 'Machine Learning', type: 'lecture', faculty: 'Prof. Michael Chen', room: 'A-104', student: 'CS502 – 45 students' },
                { subject: '', type: 'empty' },
                { subject: 'Mobile App Development', type: 'lecture', faculty: 'Ms. Lisa Wong', room: 'B-101', student: 'CS501 – 52 students' },
                { subject: '', type: 'empty' },
                { subject: '', type: 'empty' },
            ]},
        ],
        todayClasses: [
            { time: '09:00', subject: 'Compiler Design', faculty: 'Dr. Robert Kim', room: 'A-103', hour: 9, minute: 0 },
            { time: '11:00', subject: 'Artificial Intelligence', faculty: 'Prof. Michael Chen', room: 'A-104', hour: 11, minute: 0 },
            { time: '14:00', subject: 'Information Security', faculty: 'Dr. Sarah Johnson', room: 'A-101', hour: 14, minute: 0 },
            { time: '15:00', subject: 'Machine Learning', faculty: 'Prof. Michael Chen', room: 'A-104', hour: 15, minute: 0 },
        ],
    },
    'Semester 6': {
        label: '3rd Year – Semester 6',
        subjects: [
            { id: 'sub-1', code: 'CS601', subject: 'Deep Learning', type: 'lecture', faculty: 'Prof. Michael Chen', room: 'A-104', student: 'CS601 – 48 students', resources: [], assignments: [] },
            { id: 'sub-2', code: 'CS602', subject: 'Cloud Computing', type: 'lecture', faculty: 'Dr. Sarah Johnson', room: 'A-101', student: 'CS601 – 48 students', resources: [], assignments: [] },
            { id: 'sub-3', code: 'CS603', subject: 'Big Data Analytics', type: 'lab', faculty: 'Prof. Michael Chen', room: 'Lab-3', student: 'CS601 – 25 students', resources: [], assignments: [] },
            { id: 'sub-4', code: 'CS604', subject: 'IoT & Embedded Systems', type: 'lecture', faculty: 'Dr. Robert Kim', room: 'A-103', student: 'CS601 – 48 students', resources: [], assignments: [] },
            { id: 'sub-5', code: 'CS605', subject: 'Software Testing & QA', type: 'tutorial', faculty: 'Ms. Lisa Wong', room: 'B-101', student: 'CS602 – 45 students', resources: [], assignments: [] },
            { id: 'sub-6', code: 'CS606', subject: 'Natural Language Processing', type: 'lecture', faculty: 'Prof. Michael Chen', room: 'A-104', student: 'CS601 – 48 students', resources: [], assignments: [] },
        ],
        schedule: [
            { time: '09:00 - 10:00', days: [
                { subject: 'Deep Learning', type: 'lecture', faculty: 'Prof. Michael Chen', room: 'A-104', student: 'CS601 – 48 students' },
                { subject: 'Cloud Computing', type: 'lecture', faculty: 'Dr. Sarah Johnson', room: 'A-101', student: 'CS601 – 48 students' },
                { subject: 'Deep Learning', type: 'lecture', faculty: 'Prof. Michael Chen', room: 'A-104', student: 'CS601 – 48 students' },
                { subject: '', type: 'empty' },
                { subject: 'Big Data Analytics', type: 'lab', faculty: 'Prof. Michael Chen', room: 'Lab-3', student: 'CS601 – 25 students' },
            ]},
            { time: '10:00 - 11:00', days: [
                { subject: '', type: 'empty' },
                { subject: 'NLP', type: 'lecture', faculty: 'Prof. Michael Chen', room: 'A-104', student: 'CS601 – 48 students' },
                { subject: '', type: 'empty' },
                { subject: 'Software Testing', type: 'tutorial', faculty: 'Ms. Lisa Wong', room: 'B-201', student: 'CS602 – 25 students' },
                { subject: '', type: 'empty' },
            ]},
            { time: '11:00 - 12:00', days: [
                { subject: 'IoT & Embedded Systems', type: 'lecture', faculty: 'Dr. Robert Kim', room: 'A-103', student: 'CS601 – 48 students' },
                { subject: 'Deep Learning', type: 'lab', faculty: 'Prof. Michael Chen', room: 'Lab-3', student: 'CS601 – 25 students' },
                { subject: 'Cloud Computing', type: 'lab', faculty: 'Dr. Sarah Johnson', room: 'Lab-1', student: 'CS601 – 25 students' },
                { subject: 'NLP', type: 'lecture', faculty: 'Prof. Michael Chen', room: 'A-104', student: 'CS601 – 48 students' },
                { subject: '', type: 'empty' },
            ]},
            { time: '12:00 - 13:00', days: [{ subject: '', type: 'empty' },{ subject: '', type: 'empty' },{ subject: '', type: 'empty' },{ subject: '', type: 'empty' },{ subject: '', type: 'empty' }] },
            { time: '14:00 - 15:00', days: [
                { subject: 'Cloud Computing', type: 'lecture', faculty: 'Dr. Sarah Johnson', room: 'A-101', student: 'CS601 – 48 students' },
                { subject: 'IoT & Embedded Systems', type: 'lab', faculty: 'Dr. Robert Kim', room: 'Lab-2', student: 'CS601 – 25 students' },
                { subject: 'IoT & Embedded Systems', type: 'lecture', faculty: 'Dr. Robert Kim', room: 'A-103', student: 'CS601 – 48 students' },
                { subject: 'Cloud Computing', type: 'lecture', faculty: 'Dr. Sarah Johnson', room: 'A-101', student: 'CS601 – 48 students' },
                { subject: 'Software Testing & QA', type: 'lecture', faculty: 'Ms. Lisa Wong', room: 'B-101', student: 'CS602 – 45 students' },
            ]},
            { time: '15:00 - 16:00', days: [
                { subject: 'Big Data Analytics', type: 'lecture', faculty: 'Prof. Michael Chen', room: 'A-104', student: 'CS601 – 48 students' },
                { subject: '', type: 'empty' },
                { subject: 'Software Testing & QA', type: 'lecture', faculty: 'Ms. Lisa Wong', room: 'B-101', student: 'CS602 – 45 students' },
                { subject: '', type: 'empty' },
                { subject: '', type: 'empty' },
            ]},
        ],
        todayClasses: [
            { time: '09:00', subject: 'Deep Learning', faculty: 'Prof. Michael Chen', room: 'A-104', hour: 9, minute: 0 },
            { time: '11:00', subject: 'IoT & Embedded Systems', faculty: 'Dr. Robert Kim', room: 'A-103', hour: 11, minute: 0 },
            { time: '14:00', subject: 'Cloud Computing', faculty: 'Dr. Sarah Johnson', room: 'A-101', hour: 14, minute: 0 },
            { time: '15:00', subject: 'Big Data Analytics (Lab)', faculty: 'Prof. Michael Chen', room: 'Lab-3', hour: 15, minute: 0 },
        ],
    },
    'Semester 7': {
        label: '4th Year – Semester 7',
        subjects: [
            { id: 'sub-1', code: 'CS701', subject: 'Distributed Systems', type: 'lecture', faculty: 'Dr. Sarah Johnson', room: 'A-101', student: 'CS701 – 45 students', resources: [], assignments: [] },
            { id: 'sub-2', code: 'CS702', subject: 'Blockchain Technology', type: 'lecture', faculty: 'Prof. Michael Chen', room: 'A-104', student: 'CS701 – 45 students', resources: [], assignments: [] },
            { id: 'sub-3', code: 'CS703', subject: 'Quantum Computing', type: 'lecture', faculty: 'Dr. Rachel Park', room: 'B-202', student: 'CS701 – 45 students', resources: [], assignments: [] },
            { id: 'sub-4', code: 'CS704', subject: 'Project Phase I', type: 'lab', faculty: 'Dr. Robert Kim', room: 'Lab-1', student: 'CS701 – 45 students', resources: [], assignments: [] },
            { id: 'sub-5', code: 'CS705', subject: 'Elective: AR/VR Systems', type: 'lecture', faculty: 'Ms. Lisa Wong', room: 'B-101', student: 'CS701 – 40 students', resources: [], assignments: [] },
            { id: 'sub-6', code: 'CS706', subject: 'Research Methodology', type: 'tutorial', faculty: 'Dr. Sarah Johnson', room: 'A-102', student: 'CS701 – 45 students', resources: [], assignments: [] },
        ],
        schedule: [
            { time: '09:00 - 10:00', days: [
                { subject: 'Distributed Systems', type: 'lecture', faculty: 'Dr. Sarah Johnson', room: 'A-101', student: 'CS701 – 45 students' },
                { subject: 'Blockchain Technology', type: 'lecture', faculty: 'Prof. Michael Chen', room: 'A-104', student: 'CS701 – 45 students' },
                { subject: 'Distributed Systems', type: 'lecture', faculty: 'Dr. Sarah Johnson', room: 'A-101', student: 'CS701 – 45 students' },
                { subject: '', type: 'empty' },
                { subject: 'Quantum Computing', type: 'lecture', faculty: 'Dr. Rachel Park', room: 'B-202', student: 'CS701 – 45 students' },
            ]},
            { time: '10:00 - 11:00', days: [
                { subject: '', type: 'empty' },
                { subject: 'Quantum Computing', type: 'lecture', faculty: 'Dr. Rachel Park', room: 'B-202', student: 'CS701 – 45 students' },
                { subject: '', type: 'empty' },
                { subject: 'Elective: AR/VR Systems', type: 'lecture', faculty: 'Ms. Lisa Wong', room: 'B-101', student: 'CS701 – 40 students' },
                { subject: '', type: 'empty' },
            ]},
            { time: '11:00 - 12:00', days: [
                { subject: 'Elective: AR/VR Systems', type: 'lecture', faculty: 'Ms. Lisa Wong', room: 'B-101', student: 'CS701 – 40 students' },
                { subject: 'Distributed Systems', type: 'lab', faculty: 'Dr. Sarah Johnson', room: 'Lab-1', student: 'CS701 – 25 students' },
                { subject: 'Blockchain Technology', type: 'lab', faculty: 'Prof. Michael Chen', room: 'Lab-2', student: 'CS701 – 25 students' },
                { subject: 'Blockchain Technology', type: 'lecture', faculty: 'Prof. Michael Chen', room: 'A-104', student: 'CS701 – 45 students' },
                { subject: '', type: 'empty' },
            ]},
            { time: '12:00 - 13:00', days: [{ subject: '', type: 'empty' },{ subject: '', type: 'empty' },{ subject: '', type: 'empty' },{ subject: '', type: 'empty' },{ subject: '', type: 'empty' }] },
            { time: '14:00 - 15:00', days: [
                { subject: 'Project Phase I', type: 'lab', faculty: 'Dr. Robert Kim', room: 'Lab-1', student: 'CS701 – 45 students' },
                { subject: 'Research Methodology', type: 'tutorial', faculty: 'Dr. Sarah Johnson', room: 'A-102', student: 'CS701 – 25 students' },
                { subject: 'Quantum Computing', type: 'lab', faculty: 'Dr. Rachel Park', room: 'Lab-3', student: 'CS701 – 25 students' },
                { subject: 'Distributed Systems', type: 'lecture', faculty: 'Dr. Sarah Johnson', room: 'A-101', student: 'CS701 – 45 students' },
                { subject: 'Project Phase I', type: 'lab', faculty: 'Dr. Robert Kim', room: 'Lab-1', student: 'CS701 – 45 students' },
            ]},
            { time: '15:00 - 16:00', days: [
                { subject: 'Research Methodology', type: 'lecture', faculty: 'Dr. Sarah Johnson', room: 'A-102', student: 'CS701 – 45 students' },
                { subject: '', type: 'empty' },
                { subject: 'Research Methodology', type: 'tutorial', faculty: 'Dr. Sarah Johnson', room: 'A-102', student: 'CS701 – 25 students' },
                { subject: '', type: 'empty' },
                { subject: '', type: 'empty' },
            ]},
        ],
        todayClasses: [
            { time: '09:00', subject: 'Distributed Systems', faculty: 'Dr. Sarah Johnson', room: 'A-101', hour: 9, minute: 0 },
            { time: '11:00', subject: 'Elective: AR/VR Systems', faculty: 'Ms. Lisa Wong', room: 'B-101', hour: 11, minute: 0 },
            { time: '14:00', subject: 'Project Phase I (Lab)', faculty: 'Dr. Robert Kim', room: 'Lab-1', hour: 14, minute: 0 },
            { time: '15:00', subject: 'Research Methodology', faculty: 'Dr. Sarah Johnson', room: 'A-102', hour: 15, minute: 0 },
        ],
    },
    'Semester 8': {
        label: '4th Year – Semester 8',
        subjects: [
            { id: 'sub-1', code: 'CS801', subject: 'Computer Vision', type: 'lecture', faculty: 'Prof. Michael Chen', room: 'A-104', student: 'CS801 – 42 students', resources: [], assignments: [] },
            { id: 'sub-2', code: 'CS802', subject: 'Cyber Security & Forensics', type: 'lecture', faculty: 'Dr. Sarah Johnson', room: 'A-101', student: 'CS801 – 42 students', resources: [], assignments: [] },
            { id: 'sub-3', code: 'CS803', subject: 'Major Project', type: 'lab', faculty: 'Dr. Robert Kim', room: 'Lab-1', student: 'CS801 – 42 students', resources: [], assignments: [] },
            { id: 'sub-4', code: 'CS804', subject: 'Elective: Edge AI', type: 'lecture', faculty: 'Prof. Michael Chen', room: 'A-104', student: 'CS801 – 38 students', resources: [], assignments: [] },
            { id: 'sub-5', code: 'CS805', subject: 'Tech Entrepreneurship', type: 'tutorial', faculty: 'Ms. Lisa Wong', room: 'B-101', student: 'CS801 – 42 students', resources: [], assignments: [] },
            { id: 'sub-6', code: 'CS806', subject: 'Advanced Algorithms', type: 'lecture', faculty: 'Dr. Rachel Park', room: 'B-202', student: 'CS801 – 42 students', resources: [], assignments: [] },
        ],
        schedule: [
            { time: '09:00 - 10:00', days: [
                { subject: 'Computer Vision', type: 'lecture', faculty: 'Prof. Michael Chen', room: 'A-104', student: 'CS801 – 42 students' },
                { subject: 'Cyber Security', type: 'lecture', faculty: 'Dr. Sarah Johnson', room: 'A-101', student: 'CS801 – 42 students' },
                { subject: 'Computer Vision', type: 'lecture', faculty: 'Prof. Michael Chen', room: 'A-104', student: 'CS801 – 42 students' },
                { subject: '', type: 'empty' },
                { subject: 'Advanced Algorithms', type: 'lecture', faculty: 'Dr. Rachel Park', room: 'B-202', student: 'CS801 – 42 students' },
            ]},
            { time: '10:00 - 11:00', days: [
                { subject: '', type: 'empty' },
                { subject: 'Advanced Algorithms', type: 'lecture', faculty: 'Dr. Rachel Park', room: 'B-202', student: 'CS801 – 42 students' },
                { subject: '', type: 'empty' },
                { subject: 'Tech Entrepreneurship', type: 'tutorial', faculty: 'Ms. Lisa Wong', room: 'B-101', student: 'CS801 – 42 students' },
                { subject: '', type: 'empty' },
            ]},
            { time: '11:00 - 12:00', days: [
                { subject: 'Elective: Edge AI', type: 'lecture', faculty: 'Prof. Michael Chen', room: 'A-104', student: 'CS801 – 38 students' },
                { subject: 'Computer Vision', type: 'lab', faculty: 'Prof. Michael Chen', room: 'Lab-3', student: 'CS801 – 25 students' },
                { subject: 'Major Project', type: 'lab', faculty: 'Dr. Robert Kim', room: 'Lab-1', student: 'CS801 – 42 students' },
                { subject: 'Cyber Security', type: 'lecture', faculty: 'Dr. Sarah Johnson', room: 'A-101', student: 'CS801 – 42 students' },
                { subject: '', type: 'empty' },
            ]},
            { time: '12:00 - 13:00', days: [{ subject: '', type: 'empty' },{ subject: '', type: 'empty' },{ subject: '', type: 'empty' },{ subject: '', type: 'empty' },{ subject: '', type: 'empty' }] },
            { time: '14:00 - 15:00', days: [
                { subject: 'Major Project', type: 'lab', faculty: 'Dr. Robert Kim', room: 'Lab-1', student: 'CS801 – 42 students' },
                { subject: 'Tech Entrepreneurship', type: 'lecture', faculty: 'Ms. Lisa Wong', room: 'B-101', student: 'CS801 – 42 students' },
                { subject: 'Cyber Security', type: 'lab', faculty: 'Dr. Sarah Johnson', room: 'Lab-2', student: 'CS801 – 25 students' },
                { subject: 'Computer Vision', type: 'lecture', faculty: 'Prof. Michael Chen', room: 'A-104', student: 'CS801 – 42 students' },
                { subject: 'Major Project', type: 'lab', faculty: 'Dr. Robert Kim', room: 'Lab-1', student: 'CS801 – 42 students' },
            ]},
            { time: '15:00 - 16:00', days: [
                { subject: 'Tech Entrepreneurship', type: 'lecture', faculty: 'Ms. Lisa Wong', room: 'B-101', student: 'CS801 – 42 students' },
                { subject: '', type: 'empty' },
                { subject: 'Elective: Edge AI', type: 'lecture', faculty: 'Prof. Michael Chen', room: 'A-104', student: 'CS801 – 38 students' },
                { subject: '', type: 'empty' },
                { subject: '', type: 'empty' },
            ]},
        ],
        todayClasses: [
            { time: '09:00', subject: 'Computer Vision', faculty: 'Prof. Michael Chen', room: 'A-104', hour: 9, minute: 0 },
            { time: '11:00', subject: 'Elective: Edge AI', faculty: 'Prof. Michael Chen', room: 'A-104', hour: 11, minute: 0 },
            { time: '14:00', subject: 'Major Project (Lab)', faculty: 'Dr. Robert Kim', room: 'Lab-1', hour: 14, minute: 0 },
            { time: '15:00', subject: 'Tech Entrepreneurship', faculty: 'Ms. Lisa Wong', room: 'B-101', hour: 15, minute: 0 },
        ],
    },
};

// ═══════════════════════════════════════════════════════════════════════════
// YEAR → SEMESTER MAPPING
// ═══════════════════════════════════════════════════════════════════════════

const YEAR_DATA = [
    { year: 1, label: '1st Year', icon: '🌱', desc: 'Foundation semester', semesters: ['Semester 1', 'Semester 2'] },
    { year: 2, label: '2nd Year', icon: '📚', desc: 'Core concepts', semesters: ['Semester 3', 'Semester 4'] },
    { year: 3, label: '3rd Year', icon: '🚀', desc: 'Advanced topics', semesters: ['Semester 5', 'Semester 6'] },
    { year: 4, label: '4th Year', icon: '🎓', desc: 'Final year', semesters: ['Semester 7', 'Semester 8'] },
];

// ═══════════════════════════════════════════════════════════════════════════
// YEAR SETUP MODAL (Student Onboarding)
// ═══════════════════════════════════════════════════════════════════════════

function YearSetupModal({ onSelect }) {
    const [hovered, setHovered] = useState(null);

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 2000,
            background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '24px'
        }}>
            <div style={{
                background: 'var(--bg-card)', borderRadius: '20px',
                padding: '40px 36px', maxWidth: '520px', width: '100%',
                boxShadow: '0 32px 80px rgba(0,0,0,0.5)',
                border: '1px solid var(--border)',
                animation: 'fadeIn 0.3s ease'
            }}>
                {/* Header */}
                <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                    <div style={{
                        width: '64px', height: '64px', borderRadius: '16px',
                        background: 'var(--primary)', display: 'flex',
                        alignItems: 'center', justifyContent: 'center',
                        margin: '0 auto 16px', fontSize: '28px'
                    }}>🎓</div>
                    <h2 style={{ margin: '0 0 8px', fontSize: '1.5rem', fontWeight: 700 }}>Welcome to SmartTable!</h2>
                    <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9375rem' }}>
                        Which year are you currently studying in?
                    </p>
                </div>

                {/* Year Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    {YEAR_DATA.map(({ year, label, icon, desc, semesters }) => (
                        <button
                            key={year}
                            onClick={() => onSelect(year, semesters)}
                            onMouseEnter={() => setHovered(year)}
                            onMouseLeave={() => setHovered(null)}
                            style={{
                                background: hovered === year ? 'var(--primary)' : 'var(--bg-secondary)',
                                border: `2px solid ${hovered === year ? 'var(--primary)' : 'var(--border)'}`,
                                borderRadius: '14px', padding: '20px 16px',
                                cursor: 'pointer', transition: 'all 0.2s ease',
                                textAlign: 'left', width: '100%',
                                color: hovered === year ? '#fff' : 'var(--text-primary)',
                                transform: hovered === year ? 'translateY(-2px)' : 'none',
                                boxShadow: hovered === year ? '0 8px 24px rgba(99,102,241,0.3)' : 'none'
                            }}
                        >
                            <div style={{ fontSize: '28px', marginBottom: '8px' }}>{icon}</div>
                            <div style={{ fontWeight: 700, fontSize: '1rem' }}>{label}</div>
                            <div style={{ fontSize: '0.8rem', opacity: 0.75, marginTop: '2px' }}>{desc}</div>
                            <div style={{
                                fontSize: '0.75rem', marginTop: '8px', fontWeight: 600,
                                opacity: 0.85,
                                color: hovered === year ? 'rgba(255,255,255,0.9)' : 'var(--primary)'
                            }}>
                                {semesters.join(' & ')}
                            </div>
                        </button>
                    ))}
                </div>

                <p style={{ textAlign: 'center', marginTop: '20px', marginBottom: 0, color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
                    You can change this later in Settings
                </p>
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// HEADER COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

function Header({ currentPage, onToggleSidebar, role, semester, setSemester, section, setSection, yearSemesters }) {
    const { user, logout, roleConfig, roles } = useAuth();
    const { theme, toggleTheme } = useTheme();
    const { notifications, unreadCount, markAsRead, markAllAsRead, clearAll } = useNotifications();
    const [showNotifications, setShowNotifications] = useState(false);

    const pageTitles = {
        dashboard: 'Dashboard',
        timetable: 'Timetable',
        updates: 'Announcements',
        mcq: 'MCQ Test',
        revision: 'Revision Notes',
        progress: 'Progress',
        scheduler: 'Auto Scheduler',
        rooms: 'Rooms',
        subjects: 'Subjects',
        settings: 'Settings',
        analytics: 'Institute Analytics',
        workload: 'Faculty Workload',
        subjectAssignment: 'Subject Assignment',
        roomControl: 'Room Control',
        conflicts: 'Conflict Approval',
        reports: 'Reports'
    };

    const roleClass = role === roles.STUDENT
        ? 'role-student'
        : role === roles.HOD
            ? 'role-hod'
            : 'role-faculty';


    const toggleNotifications = () => setShowNotifications(!showNotifications);


    return (
        <header className="main-header">
            <div className="flex items-center gap-4">
                <button className="mobile-menu-btn" onClick={onToggleSidebar}>
                    <Icon name="menu" size={24} />
                </button>
                <div className="header-left">
                    <h1>{pageTitles[currentPage] || 'Dashboard'}</h1>
                    <span className="subtitle">
                        {new Date().toLocaleDateString('en-US', {
                            weekday: 'long',
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                        })}
                    </span>
                </div>
            </div>

            <div className="header-right">
                <div className="notification-wrapper">
                    <button 
                        className={`header-icon-btn ${showNotifications ? 'active' : ''}`} 
                        onClick={toggleNotifications}
                        title="Notifications"
                    >
                        <Icon name="bell" size={20} />
                        {unreadCount > 0 && <span className="notification-badge">{unreadCount}</span>}
                    </button>

                    {showNotifications && (
                        <div className="notification-dropdown glass">
                            <div className="notification-header">
                                <h3>Notifications</h3>
                                <div className="flex gap-2">
                                    <button onClick={markAllAsRead}>Mark all read</button>
                                    <button onClick={clearAll} className="text-secondary" style={{ opacity: 0.8 }}>Clear all</button>
                                </div>
                            </div>
                            <div className="notification-list">
                                {notifications.length === 0 ? (
                                    <div className="notification-empty">
                                        <Icon name="bell" size={32} />
                                        <p>No new notifications</p>
                                    </div>
                                ) : (
                                    notifications.map(notif => (
                                        <div 
                                            key={notif.id} 
                                            className={`notification-item ${notif.read ? '' : 'unread'}`}
                                            onClick={() => markAsRead(notif.id)}
                                        >
                                            <div className="notification-dot"></div>
                                            <div className="notification-content">
                                                <div className="notification-title">{notif.title}</div>
                                                <div className="notification-msg">{notif.message}</div>
                                                <div className="notification-time">{notif.time}</div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <div className="header-selects">
                    <select className="header-select" value={semester} onChange={e => setSemester(e.target.value)}>
                        {(yearSemesters || ['Semester 1','Semester 2','Semester 3','Semester 4','Semester 5','Semester 6','Semester 7','Semester 8']).map(s => (
                            <option key={s} value={s}>{s}</option>
                        ))}
                    </select>
                    <select className="header-select" value={section} onChange={e => setSection(e.target.value)}>
                        {['A','B','C'].map(s => <option key={s} value={`Section ${s}`}>Section {s}</option>)}
                    </select>
                </div>

                <div className={`header-badge ${roleClass}`}>
                    <Icon name="user" size={16} />
                    Logged in as: {roleConfig[role]?.label || 'User'}
                </div>

                <button className="theme-toggle" onClick={toggleTheme} title="Toggle theme">
                    <Icon name={theme === 'light' ? 'moon' : 'sun'} size={20} />
                </button>

                <div style={{ marginLeft: '1rem' }}>
                    <UserButton afterSignOutUrl="/" />
                </div>
            </div>
        </header>
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// AI TYPING ANIMATION COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

function AITypingAnimation({ messages }) {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [displayText, setDisplayText] = useState('');
    const [isDeleting, setIsDeleting] = useState(false);

    useEffect(() => {
        const currentMessage = messages[currentIndex];

        if (!isDeleting) {
            if (displayText.length < currentMessage.length) {
                const timeout = setTimeout(() => {
                    setDisplayText(currentMessage.slice(0, displayText.length + 1));
                }, 50);
                return () => clearTimeout(timeout);
            } else {
                const timeout = setTimeout(() => {
                    setIsDeleting(true);
                }, 2000);
                return () => clearTimeout(timeout);
            }
        } else {
            if (displayText.length > 0) {
                const timeout = setTimeout(() => {
                    setDisplayText(displayText.slice(0, -1));
                }, 30);
                return () => clearTimeout(timeout);
            } else {
                setIsDeleting(false);
                setCurrentIndex((prev) => (prev + 1) % messages.length);
            }
        }
    }, [displayText, isDeleting, currentIndex, messages]);

    return (
        <div className="ai-typing-container">
            <div className="ai-typing-icon">
                <Icon name="ai" size={24} />
            </div>
            <div className="ai-typing-text">
                <p>{displayText}<span className="ai-typing-cursor"></span></p>
                <span>AI is optimizing your schedule in real-time</span>
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD CARDS COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

function DashboardCards({ role, overallAttendance }) {
    const { roles } = useAuth();

    const studentCards = [
        { title: "Today's Classes", value: '4', icon: 'calendar', color: 'primary', trend: '+1 from yesterday', trendUp: true },
        { title: 'Next Lecture', value: 'DSA', icon: 'book', color: 'purple', subtitle: 'Dr. Sarah Johnson' },
        { title: 'Attendance', value: overallAttendance !== undefined ? `${overallAttendance}%` : '...', icon: 'check', color: 'green', trend: 'Live from record', trendUp: true },
        { title: 'Pending Tests', value: '2', icon: 'clipboard', color: 'orange', trend: 'Due this week', trendUp: false }
    ];

    const facultyCards = [
        { title: 'Total Classes', value: '12', icon: 'calendar', color: 'primary', trend: '+3 this week', trendUp: true },
        { title: 'Active Faculty', value: '8', icon: 'users', color: 'green', trend: 'All present', trendUp: true },
        { title: 'Available Rooms', value: '5', icon: 'rooms', color: 'cyan', subtitle: 'Out of 12 total' },
        { title: 'Conflicts', value: '0', icon: 'alert', color: 'green', trend: 'No issues', trendUp: true }
    ];

    const hodCards = [
        ...facultyCards.slice(0, 2),
        { title: 'Departments', value: '4', icon: 'building', color: 'purple', subtitle: 'All active' },
        { title: 'Pending Approvals', value: '3', icon: 'clock', color: 'orange', trend: 'Needs attention', trendUp: false }
    ];

    const cards = role === roles.STUDENT
        ? studentCards
        : role === roles.HOD
            ? hodCards
            : facultyCards;

    return (
        <div className="dashboard-grid">
            {cards.map((card, index) => (
                <div key={index} className="dashboard-card">
                    <div className="card-header">
                        <span className="card-title">{card.title}</span>
                        <div className={`card-icon ${card.color}`}>
                            <Icon name={card.icon} size={24} />
                        </div>
                    </div>
                    <div className="card-value">{card.value}</div>
                    {card.subtitle && <div className="card-subtitle">{card.subtitle}</div>}
                    {card.trend && (
                        <div className={`card-trend ${card.trendUp ? 'up' : 'down'}`}>
                            <Icon name={card.trendUp ? 'trending' : 'alert'} size={14} />
                            {card.trend}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// FACULTY/HOD DASHBOARD VIEW
// ═══════════════════════════════════════════════════════════════════════════

function FacultyDashboard({ user, subjects }) {
    const aiMessages = [
        "Analyzing room utilization patterns...",
        "Optimizing faculty workload distribution...",
        "Checking for scheduling conflicts...",
        "Generating optimal timetable suggestions..."
    ];

    const mySubjects = subjects ? subjects.filter(s => s.faculty === user?.name) : [];
    
    // MCQ Upload State
    const [showMCQModal, setShowMCQModal] = useState(false);
    const [mcqSubject, setMcqSubject] = useState('');
    const [mcqQuestions, setMcqQuestions] = useState([{ question: '', options: ['', '', '', ''], correct: 0 }]);
    const { addNotification } = useNotifications();

    const handleAddMCQ = () => {
        setMcqQuestions([...mcqQuestions, { question: '', options: ['', '', '', ''], correct: 0 }]);
    };

    const handleSaveMCQ = () => {
        if(!mcqSubject) return addNotification('Error', 'Select a subject first', 'error');
        try {
            const customMCQsStr = localStorage.getItem('smarttable-custom-mcqs');
            const customMCQs = customMCQsStr ? JSON.parse(customMCQsStr) : {};
            customMCQs[mcqSubject] = mcqQuestions;
            localStorage.setItem('smarttable-custom-mcqs', JSON.stringify(customMCQs));
            addNotification('Success', `Prior MCQ Test for ${mcqSubject} uploaded!`, 'success');
            setShowMCQModal(false);
        } catch(e) {
            console.error(e);
        }
    };

    return (
        <div className="page-content">
            <AITypingAnimation messages={aiMessages} />

            <DashboardCards role="faculty" />

            <div className="panels-grid">
                <div className="panel">
                    <div className="panel-header">
                        <div>
                            <h3 className="panel-title">Room Utilization</h3>
                            <p className="panel-subtitle">Current semester</p>
                        </div>
                    </div>
                    <div className="progress-container">
                        <div className="progress-label">
                            <span>Overall</span>
                            <span>65%</span>
                        </div>
                        <div className="progress-bar">
                            <div className="progress-bar-fill" style={{ width: '65%' }}></div>
                        </div>
                    </div>
                    <p className="text-muted" style={{ fontSize: '0.875rem' }}>
                        Room utilization is optimal. Consider adding more evening classes.
                    </p>
                </div>

                <div className="panel">
                    <div className="panel-header">
                        <div>
                            <h3 className="panel-title">Faculty Workload</h3>
                            <p className="panel-subtitle">Average hours per week</p>
                        </div>
                    </div>
                    <div className="progress-container">
                        <div className="progress-label">
                            <span>Average</span>
                            <span>12/20 hrs</span>
                        </div>
                        <div className="progress-bar">
                            <div className="progress-bar-fill green" style={{ width: '60%' }}></div>
                        </div>
                    </div>
                    <p className="text-muted" style={{ fontSize: '0.875rem' }}>
                        Faculty capacity is balanced. No overload detected.
                    </p>
                </div>
            </div>

            <div className="panel mt-6">
                <div className="panel-header">
                    <div>
                        <h3 className="panel-title">{user?.role === 'hod' ? 'Faculty Workload Distribution' : 'My Assigned Subjects'}</h3>
                        <p className="panel-subtitle">{user?.role === 'hod' ? 'Current semester' : 'Click to upload prior MCQ revision tests'}</p>
                    </div>
                </div>
                
                {user?.role === 'hod' ? (
                <div className="faculty-list">
                    <div className="faculty-item">
                        <div className="faculty-avatar">SJ</div>
                        <div className="faculty-info">
                            <div className="faculty-name">Dr. Sarah Johnson</div>
                            <div className="faculty-dept">Computer Science</div>
                        </div>
                        <div className="faculty-progress">
                            <div className="faculty-hours">15/20 hrs</div>
                            <div className="progress-bar">
                                <div className="progress-bar-fill green" style={{ width: '75%' }}></div>
                            </div>
                        </div>
                    </div>
                    <div className="faculty-item">
                        <div className="faculty-avatar">MC</div>
                        <div className="faculty-info">
                            <div className="faculty-name">Prof. Michael Chen</div>
                            <div className="faculty-dept">Data Science</div>
                        </div>
                        <div className="faculty-progress">
                            <div className="faculty-hours">12/20 hrs</div>
                            <div className="progress-bar">
                                <div className="progress-bar-fill" style={{ width: '60%' }}></div>
                            </div>
                        </div>
                    </div>
                    <div className="faculty-item">
                        <div className="faculty-avatar">RP</div>
                        <div className="faculty-info">
                            <div className="faculty-name">Dr. Rachel Park</div>
                            <div className="faculty-dept">Mathematics</div>
                        </div>
                        <div className="faculty-progress">
                            <div className="faculty-hours">18/20 hrs</div>
                            <div className="progress-bar">
                            </div>
                        </div>
                    </div>
                </div>
                ) : (
                <div className="faculty-list">
                    {mySubjects.length > 0 ? mySubjects.map(sub => (
                        <div key={sub.code} className="faculty-item" style={{ alignItems: 'center' }}>
                            <div className="faculty-avatar">{sub.code.substring(0,2)}</div>
                            <div className="faculty-info">
                                <div className="faculty-name">{sub.subject || sub.name}</div>
                                <div className="faculty-dept">{sub.code}</div>
                            </div>
                            <button className="room-btn" onClick={() => { setMcqSubject(sub.subject || sub.name); setMcqQuestions([{ question: '', options: ['', '', '', ''], correct: 0 }]); setShowMCQModal(true); }}>
                                <Icon name="upload" size={16} />
                                Upload MCQ
                            </button>
                        </div>
                    )) : <p className="text-muted" style={{ padding: '1rem' }}>No subjects assigned by HOD yet.</p>}
                </div>
                )}
            </div>

            <div className="panel mt-6">
                <div className="panel-header">
                    <div>
                        <h3 className="panel-title">Smart Suggestions</h3>
                        <p className="panel-subtitle">AI-powered recommendations</p>
                    </div>
                    <button 
                        className="room-btn toggle"
                        onClick={async () => {
                            try {
                                const res = await fetch('http://localhost:4000/api/notifications/send', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        title: 'Test Notification',
                                        message: 'This is a push notification sent from the Faculty Dashboard!',
                                        type: 'info',
                                        recipient_role: 'all'
                                    })
                                });
                                const data = await res.json();
                                if (data.success) alert('Notification triggered! Check the bell icon.');
                            } catch (e) {
                                console.error(e);
                                alert('Error sending notification. Make sure backend is running.');
                            }
                        }}
                    >
                        <Icon name="bell" size={16} />
                        Send Test Push
                    </button>
                </div>
                <div className="suggestion-cards">
                    <div className="suggestion-card success">
                        <div className="suggestion-header">
                            <div className="suggestion-icon success">
                                <Icon name="check" size={18} />
                            </div>
                            <span className="suggestion-title">Optimal Schedule Found</span>
                        </div>
                        <p className="suggestion-body">
                            The system has found an optimal schedule that maximizes room utilization
                            while minimizing faculty travel time. Apply changes to implement.
                        </p>
                    </div>
                    <div className="suggestion-card warning">
                        <div className="suggestion-header">
                            <div className="suggestion-icon warning">
                                <Icon name="alert" size={18} />
                            </div>
                            <span className="suggestion-title">Room A-104 Underutilized</span>
                        </div>
                        <p className="suggestion-body">
                            Room A-104 with capacity 60 is only used at 40% this semester.
                            Consider scheduling more classes to improve efficiency.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// TIMETABLE COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

function TimetablePage({ role, subjects, setSubjects, semester, getAuthToken }) {
    const { roles } = useAuth();
    const { addNotification } = useNotifications();
    const isStudent = role === roles.STUDENT;

    // Default schedule for current semester
    const getInitialSchedule = () => SEMESTER_DATA[semester]?.schedule || [];

    const [timetableData, setTimetableData] = useState(getInitialSchedule());
    const [isLoading, setIsLoading] = useState(false);

    // Fetch timetable from backend
    useEffect(() => {
        const fetchTimetable = async () => {
            setIsLoading(true);
            try {
                const token = await getAuthToken();
                const response = await fetch(`http://localhost:4000/api/timetable/${semester}/${role}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const result = await response.json();
                
                if (result.success && result.data && result.data.length > 0) {
                    setTimetableData(result.data);
                } else {
                    setTimetableData(getInitialSchedule());
                }
            } catch (err) {
                console.error("Fetch timetable error:", err);
                setTimetableData(getInitialSchedule());
            } finally {
                setIsLoading(false);
            }
        };

        fetchTimetable();
    }, [semester, role]);

    const saveTimetable = async (data) => {
        try {
            const token = await getAuthToken();
            await fetch('http://localhost:4000/api/timetable/save', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    semester,
                    section: 'Section A', // Default or from state
                    sessions: data
                })
            });
        } catch (err) {
            console.error("Save timetable error:", err);
        }
    };

    const fileInputRef = useRef(null);
    const [uploadContext, setUploadContext] = useState(null);

    const handleDragEnd = async (result) => {
        const { source, destination } = result;
        if (!destination) return;

        const sourceId = source.droppableId;
        const destinationId = destination.droppableId;
        const isFaculty = role === roles.FACULTY;
        const isHOD = role === roles.HOD;

        const parseCell = id => {
            const parts = id.split('-');
            return [parseInt(parts[1], 10), parseInt(parts[2], 10)];
        };

        const newTimetableData = [...timetableData];

        // dragging from subjects to a cell
        if (sourceId === 'subjects' && destinationId.startsWith('cell-')) {
            const subject = subjects[source.index];
            const [rowIndex, cellIndex] = parseCell(destinationId);
            const destCell = newTimetableData[rowIndex].days[cellIndex];

            if (destCell && destCell.type !== 'empty') {
                setSubjects(prev => {
                    const exists = prev.find(s => s.subject === destCell.subject && s.type === destCell.type);
                    if (!exists) return [...prev, { ...destCell, id: `sub-${Date.now()}` }];
                    return prev;
                });
            }

            newTimetableData[rowIndex].days[cellIndex] = { ...subject, type: 'filled' };
            setTimetableData(newTimetableData);
            saveTimetable(newTimetableData);
            return;
        }

        // dragging from cell to cell
        if (sourceId.startsWith('cell-') && destinationId.startsWith('cell-')) {
            const [srcRow, srcCol] = parseCell(sourceId);
            const [dstRow, dstCol] = parseCell(destinationId);
            const sourceCell = newTimetableData[srcRow].days[srcCol];
            const destCell = newTimetableData[dstRow].days[dstCol];

            newTimetableData[dstRow].days[dstCol] = { ...sourceCell };
            if (isHOD || isFaculty) {
                newTimetableData[srcRow].days[srcCol] = destCell.type === 'empty' ? { subject: '', type: 'empty' } : { ...destCell };
            } else {
                newTimetableData[srcRow].days[srcCol] = { subject: '', type: 'empty' };
            }

            setTimetableData(newTimetableData);
            saveTimetable(newTimetableData);
            return;
        }

        // dragging from cell to subjects
        if (sourceId.startsWith('cell-') && destinationId === 'subjects') {
            const [srcRow, srcCol] = parseCell(sourceId);
            const moving = newTimetableData[srcRow].days[srcCol];
            newTimetableData[srcRow].days[srcCol] = { subject: '', type: 'empty' };

            setSubjects(prev => {
                if (moving && moving.subject) {
                    const exists = prev.find(s => s.subject === moving.subject && s.type === moving.type);
                    if (!exists) return [...prev, { ...moving, id: `sub-${Date.now()}` }];
                }
                return prev;
            });

            setTimetableData(newTimetableData);
            saveTimetable(newTimetableData);
            return;
        }

        // reordering inside subjects
        if (sourceId === 'subjects' && destinationId === 'subjects') {
            const updated = Array.from(subjects);
            const [moved] = updated.splice(source.index, 1);
            updated.splice(destination.index, 0, moved);
            setSubjects(updated);
            return;
        }
    };

    const handleUpload = (code, type) => {
        setUploadContext({ code, type });
        if (fileInputRef.current) fileInputRef.current.click();
    };

    const onFileChange = async (e) => {
        const file = e.target.files[0];
        if (!file || !uploadContext) return;

        const { code, type } = uploadContext;
        const formData = new FormData();
        formData.append('resource', file);
        formData.append('subjectCode', code);
        formData.append('type', type);
        formData.append('title', `${type}: ${file.name}`);

        try {
            const token = await getAuthToken();
            const response = await fetch('http://localhost:4000/api/resources/upload', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });
            const result = await response.json();
            
            if (result.success) {
                addNotification('Success', `${type} uploaded for ${code}`, 'success');
                setSubjects(prev => prev.map(s => {
                    if (s.code === code) {
                        const listKey = type === 'Assignment' ? 'assignments' : 'resources';
                        return { ...s, [listKey]: [...(s[listKey] || []), result.data] };
                    }
                    return s;
                }));
            }
        } catch (err) {
            console.error("Upload error:", err);
            addNotification('Error', 'Failed to upload file', 'error');
        } finally {
            setUploadContext(null);
            e.target.value = '';
        }
    };

    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

    if (isLoading) return <div className="page-content center-flex"><div className="loader"></div></div>;

    return (
        <DragDropContext onDragEnd={handleDragEnd}>
            <div className="page-content" style={{ display: 'flex', gap: '24px' }}>
                <div className="timetable-container" style={{ flex: 1 }}>
                    <div className="timetable-legend">
                        <div className="legend-item">
                            <span className="legend-dot lecture"></span>
                            Lecture
                        </div>
                        <div className="legend-item">
                            <span className="legend-dot lab"></span>
                            Lab
                        </div>
                        <div className="legend-item">
                            <span className="legend-dot tutorial"></span>
                            Tutorial
                        </div>
                        {!isStudent && (
                            <div className="legend-item" style={{ marginLeft: 'auto', color: 'var(--primary)' }}>
                                <Icon name="edit" size={16} />
                                Drag to reschedule
                            </div>
                        )}
                    </div>

                    <table className="timetable">
                        <thead>
                            <tr>
                                <th>Time</th>
                                {days.map(day => <th key={day}>{day}</th>)}
                            </tr>
                        </thead>
                        <tbody>
                            {timetableData.map((row, rowIndex) => (
                                <tr key={rowIndex}>
                                    <td className="time-cell">{row.time}</td>
                                    {row.days.map((cell, cellIndex) => (
                                        <Droppable key={`${rowIndex}-${cellIndex}`} droppableId={`cell-${rowIndex}-${cellIndex}`}>
                                            {(provided, snapshot) => (
                                                <td>
                                                    <div 
                                                        ref={provided.innerRef}
                                                        {...provided.droppableProps}
                                                        className={`timetable-cell ${cell.type} ${cell.type === 'filled' ? cell.type : ''} ${snapshot.isDraggingOver ? 'dragging-over' : ''}`}
                                                    >
                                                        {cell.type !== 'empty' ? (
                                                            !isStudent ? (
                                                                <Draggable draggableId={`cell-${rowIndex}-${cellIndex}`} index={0} key={`cell-${rowIndex}-${cellIndex}`}>
                                                                    {(cellProvided, cellSnapshot) => (
                                                                        <div
                                                                            ref={cellProvided.innerRef}
                                                                            {...cellProvided.draggableProps}
                                                                            {...cellProvided.dragHandleProps}
                                                                        >
                                                                            <div className="subject">{cell.subject}</div>
                                                                            <div className="meta">
                                                                                {`${cell.faculty} • ${cell.room}`}
                                                                            </div>
                                                                            <div className="meta">{cell.student}</div>
                                                                        </div>
                                                                    )}
                                                                </Draggable>
                                                            ) : (
                                                                <>
                                                                    <div className="subject">{cell.subject}</div>
                                                                    <div className="meta">
                                                                        {`${cell.faculty} • ${cell.room}`}
                                                                    </div>
                                                                    <div className="meta">{cell.student}</div>
                                                                </>
                                                            )
                                                        ) : (
                                                            isStudent ? '' : 'Drop here'
                                                        )}
                                                        {provided.placeholder}
                                                    </div>
                                                </td>
                                            )}
                                        </Droppable>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {role !== roles.STUDENT && (
                    <div className="panel" style={{ width: '300px', background: 'var(--bg-card)' }}>
                        <div className="panel-header">
                            <div>
                                <h3 className="panel-title">Subjects</h3>
                                <p className="panel-subtitle">Drag to timetable</p>
                            </div>
                        </div>
                        <Droppable droppableId="subjects">
                            {(provided, snapshot) => (
                                <div
                                    ref={provided.innerRef}
                                    {...provided.droppableProps}
                                    className="subject-list"
                                    style={{
                                        background: snapshot.isDraggingOver ? 'var(--primary-subtle)' : 'transparent',
                                        minHeight: '200px'
                                    }}
                                >
                                    {subjects.map((subject, index) => {
                                        const dragId = String(subject.id || subject.code || `sub-${index}`);
                                        return (
                                        <Draggable key={dragId} draggableId={dragId} index={index}>
                                            {(provided, snapshot) => (
                                                <div
                                                    ref={provided.innerRef}
                                                    {...provided.draggableProps}
                                                    className="subject-item"
                                                    style={{
                                                        ...provided.draggableProps.style,
                                                        background: snapshot.isDragging ? 'var(--primary-light)' : 'var(--bg-secondary)',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '10px'
                                                    }}
                                                >
                                                    <div {...provided.dragHandleProps} className="drag-handle">
                                                        <Icon name="menu" size={16} />
                                                    </div>
                                                    <div className="flex justify-between items-center w-100">
                                                        <span>{subject.subject}</span>
                                                        <div className="flex gap-1">
                                                            <button 
                                                                className="icon-btn-sm" 
                                                                title="Add Assignment"
                                                                onClick={(e) => { e.stopPropagation(); handleUpload(subject.code, 'Assignment'); }}
                                                            >
                                                                <Icon name="upload" size={12} />
                                                            </button>
                                                            <button 
                                                                className="icon-btn-sm" 
                                                                title="Add Resource"
                                                                onClick={(e) => { e.stopPropagation(); handleUpload(subject.code, 'Resource'); }}
                                                            >
                                                                <Icon name="file" size={12} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </Draggable>
                                    )})}
                                    {provided.placeholder}
                                </div>
                            )}
                        </Droppable>
                    </div>
                )}
                <input 
                    type="file" 
                    ref={fileInputRef} 
                    style={{ display: 'none' }} 
                    accept=".pdf,.doc,.docx,.ppt,.pptx,.txt"
                    onChange={onFileChange}
                />
            </div>
        </DragDropContext>
    );
}


// ═══════════════════════════════════════════════════════════════════════════
// ROOMS PAGE COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

function RoomsPage({ role }) {
    const { roles } = useAuth();
    const isHOD = role === roles.HOD;
    const [rooms, setRooms] = useState([
        { id: 1, number: 'A-101', capacity: 60, status: 'available', enabled: true },
        { id: 2, number: 'A-102', capacity: 55, status: 'occupied', enabled: true },
        { id: 3, number: 'A-103', capacity: 50, status: 'available', enabled: true },
        { id: 4, number: 'A-104', capacity: 60, status: 'available', enabled: true },
        { id: 5, number: 'B-101', capacity: 45, status: 'occupied', enabled: true },
        { id: 6, number: 'B-102', capacity: 40, status: 'available', enabled: true },
        { id: 7, number: 'Lab-1', capacity: 30, status: 'occupied', enabled: true },
        { id: 8, number: 'Lab-2', capacity: 30, status: 'available', enabled: true },
        { id: 9, number: 'Lab-3', capacity: 25, status: 'available', enabled: false }
    ]);

    const toggleRoom = (id) => {
        if (!isHOD) return;
        setRooms(rooms.map(room =>
            room.id === id ? { ...room, enabled: !room.enabled } : room
        ));
    };

    return (
        <div className="page-content">
            <div className="panels-grid mb-6">
                <div className="panel">
                    <div className="panel-header">
                        <div>
                            <h3 className="panel-title">Room Overview</h3>
                            <p className="panel-subtitle">Total capacity and availability</p>
                        </div>
                    </div>
                    <div className="flex gap-6">
                        <div style={{ textAlign: 'center' }}>
                            <div className="card-value" style={{ fontSize: '2.5rem' }}>9</div>
                            <div className="text-muted">Total Rooms</div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                            <div className="card-value" style={{ fontSize: '2.5rem', color: 'var(--accent-green)' }}>6</div>
                            <div className="text-muted">Available</div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                            <div className="card-value" style={{ fontSize: '2.5rem', color: 'var(--accent-orange)' }}>3</div>
                            <div className="text-muted">Occupied</div>
                        </div>
                    </div>
                </div>
            </div>

            <h3 className="mb-4">All Rooms</h3>
            <div className="rooms-grid">
                {rooms.map(room => (
                    <div key={room.id} className={`room-card ${!room.enabled ? 'disabled' : ''}`}>
                        <div className="room-header">
                            <span className="room-number">{room.number}</span>
                            <span className={`room-status ${room.enabled ? (room.status === 'available' ? 'available' : 'occupied') : 'occupied'}`}>
                                {!room.enabled ? 'Disabled' : room.status}
                            </span>
                        </div>
                        <div className="room-details">
                            <div className="room-detail">
                                <Icon name="users" size={18} />
                                Capacity: {room.capacity} students
                            </div>
                            <div className="room-detail">
                                <Icon name="building" size={18} />
                                Type: {room.number.startsWith('Lab') ? 'Laboratory' : 'Classroom'}
                            </div>
                        </div>
                        {isHOD && (
                            <div className="room-actions">
                                <button className="room-btn edit">
                                    <Icon name="edit" size={16} />
                                    Edit
                                </button>
                                <button
                                    className="room-btn toggle"
                                    onClick={() => toggleRoom(room.id)}
                                >
                                    <Icon name={room.enabled ? 'x' : 'check'} size={16} />
                                    {room.enabled ? 'Disable' : 'Enable'}
                                </button>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div >
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS PAGE COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

function SettingsPage({ studentYear, onChangeYear }) {
    const { logout, roles, user } = useAuth();
    const { theme, toggleTheme } = useTheme();
    const [notifications, setNotifications] = useState(true);
    const [emailUpdates, setEmailUpdates] = useState(false);
    const currentYearData = studentYear ? YEAR_DATA.find(y => y.year === studentYear) : null;

    return (
        <div className="page-content">
            <div className="settings-container">
                <div className="settings-section">
                    <h3 className="settings-section-title">Appearance</h3>
                    <div className="settings-item">
                        <div className="settings-item-info">
                            <h4>Dark Mode</h4>
                            <p>Switch between light and dark themes</p>
                        </div>
                        <div
                            className={`toggle-switch ${theme === 'dark' ? 'active' : ''}`}
                            onClick={toggleTheme}
                        ></div>
                    </div>
                </div>

                <div className="settings-section">
                    <h3 className="settings-section-title">Preferences</h3>
                    <div className="settings-item">
                        <div className="settings-item-info">
                            <h4>Default Semester</h4>
                            <p>Your selected semester is saved automatically</p>
                        </div>
                        <span className="header-badge role-faculty" style={{ padding: '6px 14px' }}>Managed in header</span>
                    </div>
                    <div className="settings-item">
                        <div className="settings-item-info">
                            <h4>Default Section</h4>
                            <p>Your selected section is saved automatically</p>
                        </div>
                        <span className="header-badge role-faculty" style={{ padding: '6px 14px' }}>Managed in header</span>
                    </div>
                </div>

                <div className="settings-section">
                    <h3 className="settings-section-title">Notifications</h3>
                    <div className="settings-item">
                        <div className="settings-item-info">
                            <h4>Push Notifications</h4>
                            <p>Receive notifications for schedule changes</p>
                        </div>
                        <div
                            className={`toggle-switch ${notifications ? 'active' : ''}`}
                            onClick={() => setNotifications(!notifications)}
                        ></div>
                    </div>
                    <div className="settings-item">
                        <div className="settings-item-info">
                            <h4>Email Updates</h4>
                            <p>Receive weekly email summaries</p>
                        </div>
                        <div
                            className={`toggle-switch ${emailUpdates ? 'active' : ''}`}
                            onClick={() => setEmailUpdates(!emailUpdates)}
                        ></div>
                    </div>
                </div>

                {currentYearData && (
                    <div className="settings-section">
                        <h3 className="settings-section-title">Study Year</h3>
                        <div className="settings-item">
                            <div className="settings-item-info">
                                <h4>{currentYearData.icon} {currentYearData.label}</h4>
                                <p>Semester range: {currentYearData.semesters.join(' & ')}</p>
                            </div>
                            <button className="room-btn toggle" onClick={onChangeYear}>
                                <Icon name="edit" size={16} />
                                Change Year
                            </button>
                        </div>
                    </div>
                )}

                <div className="settings-section">
                    <h3 className="settings-section-title">Account</h3>
                    <div className="settings-item">
                        <div className="settings-item-info">
                            <h4>Logout</h4>
                            <p>Sign out of your account</p>
                        </div>
                        <button className="logout-btn" onClick={logout}>
                            <Icon name="logout" size={18} />
                            Logout
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// STUDENT DASHBOARD COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

function StudentDashboard({ semester, getAuthToken }) {
    const { user } = useAuth();
    const [overallAttendance, setOverallAttendance] = useState(0);
    const [loadingAttendance, setLoadingAttendance] = useState(true);

    const aiMessages = [
        "Analyzing your attendance patterns...",
        "Preparing personalized study recommendations...",
        "Checking upcoming test schedules..."
    ];

    useEffect(() => {
        if (!getAuthToken || !user) return;
        const fetchProgress = async () => {
            try {
                const token = await getAuthToken();
                const response = await fetch(`http://localhost:4000/api/attendance/progress/${user.email}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const result = await response.json();
                if (result.success) {
                    setOverallAttendance(result.data.overallAttendance || 0);
                }
            } catch (err) {
                console.error("Failed to fetch progress", err);
            } finally {
                setLoadingAttendance(false);
            }
        };
        fetchProgress();
    }, [user, getAuthToken]);

    // Classes sorted by time for today from selected semester
    const todayClasses = SEMESTER_DATA[semester]?.todayClasses || [];

    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const t = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(t);
    }, []);

    const nextClass = todayClasses.find(cls => {
        const classTime = new Date(now);
        classTime.setHours(cls.hour, cls.minute, 0, 0);
        return classTime > now;
    });

    const getCountdown = (cls) => {
        if (!cls) return null;
        const classTime = new Date(now);
        classTime.setHours(cls.hour, cls.minute, 0, 0);
        const diffMs = classTime - now;
        const diffSecs = Math.max(0, Math.floor(diffMs / 1000));
        
        if (diffSecs <= 0) return 'Starting now';
        
        const hrs = Math.floor(diffSecs / 3600);
        const mins = Math.floor((diffSecs % 3600) / 60);
        const secs = diffSecs % 60;
        
        if (hrs > 0) return `Starting in ${hrs}h ${mins}m ${secs}s`;
        if (mins > 0) return `Starting in ${mins}m ${secs}s`;
        return `Starting in ${secs}s`;
    };

    return (
        <div className="page-content">
            <AITypingAnimation messages={aiMessages} />

            <div className="student-dashboard-grid">
                <div>
                    <DashboardCards role="student" overallAttendance={overallAttendance} />

                    <div className="today-classes mt-6">
                        <div className="panel-header">
                            <div>
                                <h3 className="panel-title">Today's Classes</h3>
                                <p className="panel-subtitle">{todayClasses.length} classes scheduled</p>
                            </div>
                        </div>
                        {todayClasses.map((cls, index) => {
                            const classTime = new Date(now);
                            classTime.setHours(cls.hour, cls.minute, 0, 0);
                            const isPast = classTime < now;
                            return (
                                <div key={index} className="today-class-item" style={{ opacity: isPast ? 0.5 : 1 }}>
                                    <div className="class-time" style={{ textDecoration: isPast ? 'line-through' : 'none' }}>{cls.time}</div>
                                    <div className="class-details">
                                        <div className="class-name">{cls.subject}</div>
                                        <div className="class-meta">{cls.faculty} • {cls.room}</div>
                                    </div>
                                    {isPast && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Done</span>}
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div>
                    <div className="next-lecture-card mb-6">
                        <h3>Next Lecture</h3>
                        {nextClass ? (
                            <>
                                <div className="subject">{nextClass.subject}</div>
                                <div className="meta">{nextClass.faculty} • {nextClass.room}</div>
                                <div className="meta mt-2" style={{ color: '#ffffff', fontWeight: 600, opacity: 0.95 }}>{getCountdown(nextClass)}</div>
                            </>
                        ) : (
                            <>
                                <div className="subject">No more classes</div>
                                <div className="meta mt-2">All done for today! 🎉</div>
                            </>
                        )}
                    </div>

                    <div className="panel">
                        <div className="panel-header">
                            <div>
                                <h3 className="panel-title">Attendance</h3>
                                <p className="panel-subtitle">This semester</p>
                            </div>
                        </div>
                        <div className="progress-circle" style={{ '--progress': `${overallAttendance}%`, background: `conic-gradient(var(--accent-green) var(--progress), var(--bg-secondary) var(--progress))` }}>
                            <span>{overallAttendance}%</span>
                        </div>
                        <p className="text-center text-muted">
                            {overallAttendance >= 75 ? 'Above 75% required' : 'Warning: Below 75% threshold'}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// UPDATES PAGE (Student)
// ═══════════════════════════════════════════════════════════════════════════

function UpdatesPage() {
    const updates = [
        { id: 1, title: 'Mid-term Examination Schedule', date: 'Feb 15, 2026', category: 'exam', content: 'Mid-term examinations will be conducted from Feb 20-25. Detailed schedule will be uploaded soon.' },
        { id: 2, title: 'Guest Lecture on AI', date: 'Feb 18, 2026', category: 'event', content: 'Dr. John Smith from MIT will conduct a guest lecture on Artificial Intelligence applications.' },
        { id: 3, title: 'Lab Maintenance', date: 'Feb 16, 2026', category: 'notice', content: 'Lab-2 will be closed for maintenance on Saturday. Please plan accordingly.' },
        { id: 4, title: 'Assignment Deadline Extended', date: 'Feb 14, 2026', category: 'academic', content: 'The Database Systems assignment deadline has been extended by 3 days.' }
    ];

    const categoryColors = {
        exam: 'var(--accent-red)',
        event: 'var(--accent-purple)',
        notice: 'var(--accent-orange)',
        academic: 'var(--accent-green)'
    };

    return (
        <div className="page-content">
            <div className="panels-grid">
                {updates.map(update => (
                    <div key={update.id} className="panel">
                        <div className="panel-header">
                            <div>
                                <span style={{
                                    fontSize: '0.75rem',
                                    fontWeight: '600',
                                    color: categoryColors[update.category],
                                    textTransform: 'uppercase'
                                }}>
                                    {update.category}
                                </span>
                                <h3 className="panel-title" style={{ marginTop: '4px' }}>{update.title}</h3>
                            </div>
                        </div>
                        <p className="text-muted" style={{ fontSize: '0.9375rem', marginBottom: '12px' }}>
                            {update.content}
                        </p>
                        <span className="text-muted" style={{ fontSize: '0.8125rem' }}>
                            {update.date}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// MCQ TEST PAGE (Student)
// ═══════════════════════════════════════════════════════════════════════════

const MCQ_DATABASE = {
    'Data Structures': [
        { question: 'What is the time complexity of binary search?', options: ['O(n)', 'O(log n)', 'O(n²)', 'O(1)'], correct: 1 },
        { question: 'Which data structure uses LIFO principle?', options: ['Queue', 'Stack', 'Array', 'Linked List'], correct: 1 },
        { question: 'What is a complete binary tree?', options: ['Every node has exactly 2 children', 'All levels except last are completely filled', 'All leaves are at the same level', 'Every node has at least 2 children'], correct: 1 },
        { question: 'Which data structure is used for BFS?', options: ['Stack', 'Queue', 'Graph', 'Tree'], correct: 1 },
        { question: 'Which algorithm is used to find shortest path?', options: ['DFS', 'Dijkstra', 'Floyd Cycle', 'Kruskal'], correct: 1 },
        { question: 'A hash table resolves collision using?', options: ['Chaining', 'Hashing', 'Sorting', 'Searching'], correct: 0 },
        { question: 'Quick sort worst case complexity?', options: ['O(1)', 'O(n log n)', 'O(n²)', 'O(n)'], correct: 2 },
    ],
    'Operating Systems': [
        { question: 'What is a typical size of an OS page?', options: ['4KB', '1MB', '512B', '64KB'], correct: 0 },
        { question: 'Which scheduling algorithm prevents starvation?', options: ['SJF', 'RR', 'Priority', 'FCFS'], correct: 1 },
        { question: 'What handles thrashing?', options: ['Page replacement', 'Working set model', 'Swapping', 'Interrupt handling'], correct: 1 },
        { question: 'What does a semaphore protect?', options: ['Registers', 'Deadlock', 'Critical Section', 'Interrupts'], correct: 2 },
        { question: 'Context switch time is mostly...', options: ['CPU bound', 'Overhead', 'Zero', 'Productive'], correct: 1 },
        { question: 'Mutual exclusion is a condition for...', options: ['Paging', 'Thrashing', 'Deadlock', 'Multithreading'], correct: 2 },
        { question: 'Which module connects processor to memory?', options: ['TLB', 'MMU', 'Cache', 'Bus'], correct: 1 }
    ],
    'Database Systems': [
        { question: 'Which is a NoSQL DB?', options: ['MySQL', 'PostgreSQL', 'MongoDB', 'Oracle'], correct: 2 },
        { question: 'What does ACID stand for?', options: ['Atomicity, Consistency, Isolation, Durability', 'Active, Concurrent, Independent, Durable', 'All Correct In Data', 'Atomicity, Consistency, Independence, DB'], correct: 0 },
        { question: 'Which key uniquely identifies a row?', options: ['Foreign Key', 'Primary Key', 'Super Key', 'Composite Key'], correct: 1 },
        { question: 'SQL command to remove a table?', options: ['DELETE', 'TRUNCATE', 'DROP', 'REMOVE'], correct: 2 },
        { question: 'Data normalization reduces...', options: ['Performance', 'Redundancy', 'Queries', 'Tables'], correct: 1 },
        { question: 'A left join returns...', options: ['All rows from right', 'All intersecting rows', 'All rows from left', 'None of the above'], correct: 2 },
        { question: 'Transaction rollback ensures...', options: ['Durability', 'Atomicity', 'Isolation', 'Consistency'], correct: 1 }
    ]
};

const GENERIC_MCQ_QUESTIONS = [
    { question: 'What is the main concept of this subject?', options: ['Theory', 'Practice', 'Both', 'None'], correct: 2 },
    { question: 'Which of the following is true?', options: ['Option A', 'Option B', 'Option C', 'All of the above'], correct: 3 },
    { question: 'What is the scope of this topic?', options: ['Local', 'Global', 'Universal', 'Limited'], correct: 1 },
    { question: 'How is this applied in industry?', options: ['Engineering', 'Finance', 'Healthcare', 'Research'], correct: 3 },
    { question: 'What is the most common challenge here?', options: ['Complexity', 'Cost', 'Time', 'Scale'], correct: 0 },
    { question: 'Which principle governs this field?', options: ['Efficiency', 'Redundancy', 'Opacity', 'Stagnation'], correct: 0 },
    { question: 'What is typically measured as success?', options: ['Performance', 'Failure Rate', 'Downtime', 'Bugs'], correct: 0 }
];

function MCQPage({ subjects }) {
    const { user } = useAuth();
    const [selectedSubject, setSelectedSubject] = useState('');
    const [testQuestions, setTestQuestions] = useState([]);
    const [isStarted, setIsStarted] = useState(false);
    const [currentQuestion, setCurrentQuestion] = useState(0);
    const [answers, setAnswers] = useState({}); // { questionIndex: selectedOptionIndex }
    const [timeLeft, setTimeLeft] = useState(600); // 10 minutes
    const [showResult, setShowResult] = useState(false);

    const availableSubjects = subjects && subjects.length > 0
        ? Array.from(new Set(subjects.map(s => s.subject || s.name).filter(Boolean)))
        : Object.keys(MCQ_DATABASE);

    const handleStartTest = () => {
        if (!selectedSubject) return;
        let pool = MCQ_DATABASE[selectedSubject] || GENERIC_MCQ_QUESTIONS;
        
        // Load prior MCQ test uploaded by faculty if exists
        try {
            const customMCQsStr = localStorage.getItem('smarttable-custom-mcqs');
            if (customMCQsStr) {
                const customMCQs = JSON.parse(customMCQsStr);
                if (customMCQs[selectedSubject] && customMCQs[selectedSubject].length > 0) {
                    pool = customMCQs[selectedSubject];
                }
            }
        } catch(e) { }

        // randomly shuffle and pick up to 5
        const shuffled = [...pool].sort(() => 0.5 - Math.random());
        setTestQuestions(shuffled.slice(0, 5));
        setIsStarted(true);
        setTimeLeft(600);
    };

    useEffect(() => {
        if (isStarted && timeLeft > 0 && !showResult) {
            const timer = setInterval(() => setTimeLeft(prev => prev - 1), 1000);
            return () => clearInterval(timer);
        } else if (isStarted && timeLeft === 0) {
            setShowResult(true);
        }
    }, [isStarted, timeLeft, showResult]);

    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const { addNotification } = useNotifications();
    const handleSubmit = async () => {
        const correct = testQuestions.filter((q, i) => answers[i] === q.correct).length;
        const msg = `You scored ${correct}/${testQuestions.length} in ${selectedSubject}`;
        
        addNotification('Test Completed', msg, correct >= testQuestions.length / 2 ? 'success' : 'warning');
        
        // Save to Supabase (Non-blocking)
        if (user) {
            fetch('http://localhost:4000/api/profile/mcq/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: user.email,
                    result: {
                        title: `${selectedSubject} Quiz`,
                        score: correct,
                        total: testQuestions.length,
                        date: new Date().toISOString()
                    }
                })
            }).catch(err => console.error("Error saving MCQ result:", err));
        }
        
        setShowResult(true);
    };

    if (showResult) {
        const correct = testQuestions.filter((q, i) => answers[i] === q.correct).length;
        return (
            <div className="page-content">
                <div className="panel text-center" style={{ padding: '60px' }}>
                    <div className="card-icon primary" style={{ margin: '0 auto 24px', width: '80px', height: '80px', fontSize: '2rem' }}>
                        <Icon name="award" size={40} />
                    </div>
                    <h2>Test Completed!</h2>
                    <p className="text-muted mt-2">You scored</p>
                    <div className="card-value" style={{ fontSize: '3rem', margin: '16px 0' }}>
                        {correct}/{testQuestions.length}
                    </div>
                    <p className="text-muted">
                        {correct === testQuestions.length ? 'Perfect score! Great job!' :
                            correct >= testQuestions.length / 2 ? 'Good work! Keep practicing!' :
                                'Keep studying and try again!'}
                    </p>
                    <div className="mt-6">
                        {testQuestions.map((q, i) => (
                            <div key={i} style={{ textAlign: 'left', marginBottom: '12px', padding: '12px', borderRadius: '8px', background: answers[i] === q.correct ? 'var(--accent-green-light, #e6f9f0)' : 'var(--accent-red-light, #fff0f0)' }}>
                                <strong>Q{i+1}:</strong> {q.question}<br/>
                                <span style={{ color: 'var(--accent-green)' }}>✔ {q.options[q.correct]}</span>
                                {answers[i] !== q.correct && answers[i] !== undefined && <span style={{ color: 'var(--accent-red)', marginLeft: 16 }}>✘ Your answer: {q.options[answers[i]]}</span>}
                                {answers[i] === undefined && <span style={{ color: 'var(--text-muted)', marginLeft: 16 }}>Not answered</span>}
                            </div>
                        ))}
                    </div>
                    <button className="room-btn toggle mt-6" onClick={() => { setShowResult(false); setAnswers({}); setCurrentQuestion(0); setTimeLeft(600); setIsStarted(false); setSelectedSubject(''); }}>Retry Test</button>
                </div>
            </div>
        );
    }

    if (!isStarted) {
        return (
            <div className="page-content">
                <div className="panel text-center" style={{ padding: '60px' }}>
                    <div className="card-icon primary" style={{ margin: '0 auto 24px', width: '80px', height: '80px', fontSize: '2rem' }}>
                        <Icon name="clock" size={40} />
                    </div>
                    <h2>Ready to start the test?</h2>
                    
                    <div className="mt-6" style={{ maxWidth: '400px', margin: '0 auto' }}>
                        <label style={{ display: 'block', textAlign: 'left', marginBottom: '8px', color: 'var(--text-muted)' }}>Select a Subject:</label>
                        <select 
                            className="form-input" 
                            style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', marginBottom: '24px' }}
                            value={selectedSubject}
                            onChange={(e) => setSelectedSubject(e.target.value)}
                        >
                            <option value="">-- Choose Subject --</option>
                            {availableSubjects.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </div>

                    {selectedSubject && (
                        <div className="mt-6" style={{ textAlign: 'left', maxWidth: '400px', margin: '24px auto' }}>
                            <p><strong>Topic:</strong> {selectedSubject} - Randomizer</p>
                            <p><strong>Time Limit:</strong> 10 minutes</p>
                            <p><strong>Questions:</strong> 5 (Randomly selected)</p>
                            <p className="mt-4 text-muted">Please ensure you have a stable internet connection before starting.</p>
                            <button className="login-btn mt-6" onClick={handleStartTest} style={{ width: '100%' }}>
                                Start Test
                            </button>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="page-content">
            <div className="mcq-test-container">
                <div className="mcq-header">
                    <div>
                        <h2>{selectedSubject} - Quiz</h2>
                        <p className="text-muted">Answer all questions within the time limit</p>
                    </div>
                    <div className="mcq-timer-container">
                        <div className="mcq-timer">
                            <Icon name="clock" size={20} />
                            {formatTime(timeLeft)}
                        </div>
                        <div className="mcq-progress-bar-container">
                            <div 
                                className="mcq-progress-bar-fill" 
                                style={{ width: `${(timeLeft / 600) * 100}%` }}
                            ></div>
                        </div>
                    </div>
                </div>

                <div className="mcq-question">
                    <div className="mcq-question-number">
                        Question {currentQuestion + 1} of {testQuestions.length}
                    </div>
                    <div className="mcq-question-text">
                        {testQuestions[currentQuestion].question}
                    </div>
                </div>

                <div className="mcq-options">
                    {testQuestions[currentQuestion].options.map((option, index) => (
                        <button
                            key={index}
                            className={`mcq-option ${answers[currentQuestion] === index ? 'selected' : ''}`}
                            onClick={() => setAnswers(prev => ({ ...prev, [currentQuestion]: index }))}
                        >
                            {option}
                        </button>
                    ))}
                </div>

                <div className="flex justify-between mt-6">
                    <button
                        className="room-btn toggle"
                        disabled={currentQuestion === 0}
                        onClick={() => setCurrentQuestion(currentQuestion - 1)}
                    >
                        Previous
                    </button>
                    {currentQuestion < testQuestions.length - 1 ? (
                        <button
                            className={`room-btn edit ${answers[currentQuestion] !== undefined ? 'btn-glow' : ''}`}
                            onClick={() => setCurrentQuestion(currentQuestion + 1)}
                        >
                            Next Question
                        </button>
                    ) : (
                        <button
                            className={`login-btn ${answers[currentQuestion] !== undefined ? 'btn-glow' : ''}`}
                            onClick={handleSubmit}
                        >
                            Submit Test
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// PROGRESS PAGE (Student)
// ═══════════════════════════════════════════════════════════════════════════

function ProgressPage({ getAuthToken }) {
    const { user } = useAuth();
    const [progressData, setProgressData] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchProgress = async () => {
            try {
                const token = await getAuthToken();
                const response = await fetch(`http://localhost:4000/api/attendance/progress/${user.email}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const result = await response.json();
                if (result.success) {
                    setProgressData(result.data);
                }
            } catch (err) {
                console.error("Failed to fetch progress", err);
            } finally {
                setLoading(false);
            }
        };
        fetchProgress();
    }, [user, getAuthToken]);

    if (loading) return <div className="page-content"><p>Loading progress...</p></div>;

    const { subjects = [], overallAttendance = 0, overallMarks = 0 } = progressData || {};

    return (
        <div className="page-content">
            <div className="panels-grid mb-6">
                <div className="panel text-center">
                    <h3 className="panel-title mb-4">Overall Performance</h3>
                    <div className="progress-circle" style={{ '--progress': `${overallMarks}%` }}>
                        <span>{overallMarks}%</span>
                    </div>
                    <p className="text-muted">Average across all subjects</p>
                </div>
                <div className="panel text-center">
                    <h3 className="panel-title mb-4">Overall Attendance</h3>
                    <div className="progress-circle" style={{ '--progress': `${overallAttendance}%`, background: `conic-gradient(var(--accent-green) var(--progress), var(--bg-secondary) var(--progress))` }}>
                        <span>{overallAttendance}%</span>
                    </div>
                    <p className="text-muted">{overallAttendance >= 75 ? 'Above' : 'Below'} 75% threshold</p>
                </div>
            </div>

            <div className="panel">
                <div className="panel-header">
                    <div>
                        <h3 className="panel-title">Subject-wise Progress</h3>
                        <p className="panel-subtitle">Attendance and marks</p>
                    </div>
                </div>
                {subjects.length === 0 && <p className="text-muted">No attendance data yet.</p>}
                {subjects.map((subject, index) => (
                    <div key={index} className="progress-container">
                        <div className="progress-label">
                            <span>{subject.name}</span>
                            <span>{subject.marks}% | {subject.attendance}%</span>
                        </div>
                        <div className="progress-bar" style={{ marginBottom: '8px' }}>
                            <div className="progress-bar-fill" style={{ width: `${subject.marks}%` }}></div>
                        </div>
                        <div className="progress-bar">
                            <div className="progress-bar-fill green" style={{ width: `${subject.attendance}%` }}></div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// ATTENDANCE PAGE (Faculty)
// ═══════════════════════════════════════════════════════════════════════════

function FacultyAttendancePage({ getAuthToken }) {
    const { user } = useAuth();
    const { addNotification } = useNotifications();
    const [students, setStudents] = useState([]);
    const [selectedSubject, setSelectedSubject] = useState('');
    const [selectedYear, setSelectedYear] = useState('');
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [attendanceState, setAttendanceState] = useState({});

    // Using dummy subjects for faculty attendance demo
    const subjects = [
        { code: 'CS301', name: 'Data Structures' },
        { code: 'CS302', name: 'Database Systems' },
        { code: 'CS303', name: 'Web Development' },
        { code: 'CS304', name: 'Operating Systems' },
        { code: 'CS401', name: 'Machine Learning' },
        { code: 'MA301', name: 'Discrete Mathematics' }
    ];

    useEffect(() => {
        if (!selectedSubject || !selectedYear) return;
        const fetchStudents = async () => {
            try {
                const token = await getAuthToken();
                // Calling backend to fetch strictly real students from database
                let url = `http://localhost:4000/api/attendance/students/${selectedSubject}?year=${selectedYear}`;
                const response = await fetch(url, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const result = await response.json();
                if (result.success) {
                    setStudents(result.data);
                    const initAtt = {};
                    result.data.forEach(s => initAtt[s.email] = 'present');
                    setAttendanceState(initAtt);
                }
            } catch (err) {
                console.error("Failed to fetch students", err);
            }
        };
        fetchStudents();
    }, [selectedSubject, selectedYear, getAuthToken, user.email]);

    const handleToggle = (email) => {
        setAttendanceState(prev => ({
            ...prev,
            [email]: prev[email] === 'present' ? 'absent' : 'present'
        }));
    };

    const handleSubmit = async () => {
        if (!selectedSubject || !date) return;
        try {
            const token = await getAuthToken();
            const payload = {
                subjectCode: selectedSubject,
                date,
                attendances: Object.keys(attendanceState).map(email => ({
                    email,
                    status: attendanceState[email]
                }))
            };
            const response = await fetch(`http://localhost:4000/api/attendance/mark`, {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            if (result.success) {
                addNotification('Success', 'Attendance marked successfully', 'success');
                setStudents([]);
                setSelectedSubject('');
            }
        } catch (err) {
            console.error(err);
            addNotification('Error', 'Failed to mark attendance', 'error');
        }
    };

    return (
        <div className="page-content">
            <div className="panel">
                <div className="panel-header">
                    <div>
                        <h3 className="panel-title">Take Attendance</h3>
                        <p className="panel-subtitle">Select a subject and date to mark attendance.</p>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '16px', marginBottom: '24px' }}>
                    <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)' }}>Year</label>
                        <select 
                            className="form-input" 
                            value={selectedYear} 
                            onChange={(e) => setSelectedYear(e.target.value)}
                            style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                        >
                            <option value="">Select Year</option>
                            <option value="1">1st Year</option>
                            <option value="2">2nd Year</option>
                            <option value="3">3rd Year</option>
                            <option value="4">4th Year</option>
                        </select>
                    </div>
                    <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)' }}>Subject</label>
                        <select 
                            className="form-input" 
                            value={selectedSubject} 
                            onChange={(e) => setSelectedSubject(e.target.value)}
                            disabled={!selectedYear}
                            style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                        >
                            <option value="">Select Subject</option>
                            {subjects.map(s => <option key={s.code} value={s.code}>{s.code} - {s.name}</option>)}
                        </select>
                    </div>
                    <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)' }}>Date</label>
                        <input 
                            type="date" 
                            className="form-input" 
                            value={date} 
                            onChange={(e) => setDate(e.target.value)}
                            style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                        />
                    </div>
                </div>

                {students.length > 0 && (
                    <>
                        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '16px' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                                    <th style={{ padding: '12px', color: 'var(--text-muted)', fontWeight: 500 }}>Student ID</th>
                                    <th style={{ padding: '12px', color: 'var(--text-muted)', fontWeight: 500 }}>Name</th>
                                    <th style={{ padding: '12px', color: 'var(--text-muted)', fontWeight: 500 }}>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {students.map((student) => (
                                    <tr key={student.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                        <td style={{ padding: '12px' }}>{student.id}</td>
                                        <td style={{ padding: '12px' }}>{student.name}</td>
                                        <td style={{ padding: '12px' }}>
                                            <button 
                                                onClick={() => handleToggle(student.email)}
                                                style={{
                                                    padding: '6px 12px',
                                                    borderRadius: '6px',
                                                    border: 'none',
                                                    cursor: 'pointer',
                                                    fontWeight: 600,
                                                    background: attendanceState[student.email] === 'present' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                                                    color: attendanceState[student.email] === 'present' ? 'var(--accent-green)' : 'var(--accent-orange)'
                                                }}
                                            >
                                                {attendanceState[student.email] === 'present' ? 'Present' : 'Absent'}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end' }}>
                            <button className="login-btn" onClick={handleSubmit} style={{ padding: '12px 24px' }}>
                                Submit Attendance
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// HOD SPECIFIC PAGES
// ═══════════════════════════════════════════════════════════════════════════

function AnalyticsPage() {
    return (
        <div className="page-content">
            <div className="analytics-grid">
                <div className="dashboard-card">
                    <div className="card-header">
                        <span className="card-title">Total Students</span>
                        <div className="card-icon cyan"><Icon name="users" size={24} /></div>
                    </div>
                    <div className="card-value">1,248</div>
                    <div className="card-trend up"><Icon name="trending" size={14} />+5% from last semester</div>
                </div>
                <div className="dashboard-card">
                    <div className="card-header">
                        <span className="card-title">Total Faculty</span>
                        <div className="card-icon green"><Icon name="briefcase" size={24} /></div>
                    </div>
                    <div className="card-value">48</div>
                    <div className="card-trend up"><Icon name="trending" size={14} />+2 new this year</div>
                </div>
                <div className="dashboard-card">
                    <div className="card-header">
                        <span className="card-title">Departments</span>
                        <div className="card-icon purple"><Icon name="building" size={24} /></div>
                    </div>
                    <div className="card-value">4</div>
                    <div className="card-subtitle">All active</div>
                </div>
                <div className="dashboard-card">
                    <div className="card-header">
                        <span className="card-title">Avg Attendance</span>
                        <div className="card-icon primary"><Icon name="check" size={24} /></div>
                    </div>
                    <div className="card-value">87%</div>
                    <div className="card-trend up"><Icon name="trending" size={14} />+2% improvement</div>
                </div>
            </div>

            <div className="panels-grid">
                <div className="panel">
                    <div className="panel-header">
                        <div>
                            <h3 className="panel-title">Department Performance</h3>
                            <p className="panel-subtitle">Average marks by department</p>
                        </div>
                    </div>
                    {[['Computer Science', 88], ['Data Science', 82], ['Information Tech', 79], ['AI & ML', 91]].map(([dept, pct], i) => (
                        <div key={i} className="progress-container">
                            <div className="progress-label">
                                <span>{dept}</span>
                                <span>{pct}%</span>
                            </div>
                            <div className="progress-bar">
                                <div className="progress-bar-fill" style={{ width: `${pct}%` }}></div>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="panel">
                    <div className="panel-header">
                        <div>
                            <h3 className="panel-title">Resource Utilization</h3>
                            <p className="panel-subtitle">Rooms and labs</p>
                        </div>
                    </div>
                    <div className="progress-container">
                        <div className="progress-label">
                            <span>Classrooms</span>
                            <span>72%</span>
                        </div>
                        <div className="progress-bar">
                            <div className="progress-bar-fill" style={{ width: '72%' }}></div>
                        </div>
                    </div>
                    <div className="progress-container">
                        <div className="progress-label">
                            <span>Computer Labs</span>
                            <span>85%</span>
                        </div>
                        <div className="progress-bar">
                            <div className="progress-bar-fill green" style={{ width: '85%' }}></div>
                        </div>
                    </div>
                    <div className="progress-container">
                        <div className="progress-label">
                            <span>Conference Rooms</span>
                            <span>45%</span>
                        </div>
                        <div className="progress-bar">
                            <div className="progress-bar-fill orange" style={{ width: '45%' }}></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function WorkloadPage() {
    const faculty = [
        { name: 'Dr. Sarah Johnson', dept: 'Computer Science', load: 18, max: 20 },
        { name: 'Prof. Michael Chen', dept: 'Data Science', load: 15, max: 20 },
        { name: 'Dr. Rachel Park', dept: 'Mathematics', load: 20, max: 20 },
        { name: 'Dr. Robert Kim', dept: 'Operating Systems', load: 14, max: 20 },
        { name: 'Ms. Lisa Wong', dept: 'Web Development', load: 16, max: 20 }
    ];

    return (
        <div className="page-content">
            <div className="panel">
                <div className="panel-header">
                    <div>
                        <h3 className="panel-title">Faculty Workload Distribution</h3>
                        <p className="panel-subtitle">Hours per week</p>
                    </div>
                </div>
                <table className="workload-table">
                    <thead>
                        <tr>
                            <th>Faculty Name</th>
                            <th>Department</th>
                            <th>Load</th>
                            <th>Utilization</th>
                        </tr>
                    </thead>
                    <tbody>
                        {faculty.map((f, i) => (
                            <tr key={i}>
                                <td><strong>{f.name}</strong></td>
                                <td>{f.dept}</td>
                                <td>{f.load}/{f.max} hrs</td>
                                <td>
                                    <div className="workload-bar">
                                        <div
                                            className="workload-bar-fill"
                                            style={{ width: `${(f.load / f.max) * 100}%` }}
                                        ></div>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function RoomControlPage() {
    return <RoomsPage role="hod" />;
}

function ConflictsPage() {
    const conflicts = [
        { id: 1, type: 'Room Double Booking', description: 'Room A-101 booked for both CS301 and CS302 at 09:00 AM on Tuesday', status: 'pending' },
        { id: 2, type: 'Faculty Overlap', description: 'Dr. Sarah Johnson scheduled for two classes at same time', status: 'resolved' },
        { id: 3, type: 'Lab Capacity', description: 'Lab-3 capacity exceeded for Machine Learning class', status: 'pending' }
    ];

    return (
        <div className="page-content">
            <div className="panels-grid">
                {conflicts.map(conflict => (
                    <div key={conflict.id} className={`suggestion-card ${conflict.status === 'pending' ? 'warning' : 'success'}`}>
                        <div className="suggestion-header">
                            <div className={`suggestion-icon ${conflict.status === 'pending' ? 'warning' : 'success'}`}>
                                <Icon name={conflict.status === 'pending' ? 'alert' : 'check'} size={18} />
                            </div>
                            <span className="suggestion-title">{conflict.type}</span>
                        </div>
                        <p className="suggestion-body">{conflict.description}</p>
                        <div className="flex gap-2 mt-4">
                            <button className="room-btn edit">View Details</button>
                            {conflict.status === 'pending' && (
                                <button className="room-btn toggle">Resolve</button>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function ReportsPage() {
    return (
        <div className="page-content">
            <div className="panels-grid">
                <div className="panel">
                    <div className="panel-header">
                        <div>
                            <h3 className="panel-title">Export Reports</h3>
                            <p className="panel-subtitle">Generate and download reports</p>
                        </div>
                    </div>
                    <div className="flex flex-col gap-4">
                        {['Faculty Schedule', 'Room Utilization', 'Student Attendance', 'Course Coverage', 'Workload Summary'].map((report, i) => (
                            <button key={i} className="room-btn edit" style={{ justifyContent: 'flex-start' }}>
                                <Icon name="download" size={18} />
                                {report}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="panel">
                    <div className="panel-header">
                        <div>
                            <h3 className="panel-title">Quick Stats</h3>
                            <p className="panel-subtitle">This semester</p>
                        </div>
                    </div>
                    <div className="flex flex-col gap-4">
                        <div className="flex justify-between">
                            <span>Total Classes Scheduled</span>
                            <strong>1,456</strong>
                        </div>
                        <div className="flex justify-between">
                            <span>Conflicts Resolved</span>
                            <strong>24</strong>
                        </div>
                        <div className="flex justify-between">
                            <span>Room Changes</span>
                            <strong>18</strong>
                        </div>
                        <div className="flex justify-between">
                            <span>Faculty Changes</span>
                            <strong>7</strong>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// SUBJECT ASSIGNMENT PAGE (HOD)
// ═══════════════════════════════════════════════════════════════════════════

function SubjectAssignmentPage({ subjects, setSubjects }) {
    const { addNotification } = useNotifications();

    const [data, setData] = useState(() => {
        const uniqueFaculties = [...new Set((subjects || []).map(s => s.faculty).filter(Boolean))];
        const facultyDict = {};
        const columnsDict = {
            'unassigned': { id: 'unassigned', title: 'Unassigned Subjects', subjectIds: [] }
        };
        
        uniqueFaculties.forEach((fac, idx) => {
            const fId = `faculty-${idx}`;
            facultyDict[fId] = { id: fId, name: fac, subjectIds: [] };
            columnsDict[fId] = { id: fId, title: fac, subjectIds: [] };
        });

        const subjectDict = {};
        (subjects || []).forEach(sub => {
            subjectDict[sub.code] = { id: sub.code, name: sub.subject || sub.name };
            if (!sub.faculty || sub.faculty.trim() === '') {
                columnsDict['unassigned'].subjectIds.push(sub.code);
            } else {
                const fId = Object.keys(facultyDict).find(k => facultyDict[k].name === sub.faculty);
                if (fId) {
                    columnsDict[fId].subjectIds.push(sub.code);
                    facultyDict[fId].subjectIds.push(sub.code);
                } else {
                    columnsDict['unassigned'].subjectIds.push(sub.code);
                }
            }
        });

        return {
            subjects: subjectDict,
            faculty: facultyDict,
            columns: columnsDict,
            columnOrder: ['unassigned', ...Object.keys(facultyDict)]
        };
    });
    // Synchronize global changes back into local state if subjects change radically.
    // To simplify for this MVP, we only read subjects once into initial state.


    const onDragEnd = (result) => {
        const { destination, source, draggableId } = result;
        if (!destination) return;
        if (destination.droppableId === source.droppableId && destination.index === source.index) return;

        const sourceCol = data.columns[source.droppableId];
        const destCol = data.columns[destination.droppableId];

        if (sourceCol === destCol) {
            const newSubjectIds = Array.from(sourceCol.subjectIds);
            newSubjectIds.splice(destination.index, 0, draggableId);
            setData(prev => ({ ...prev, columns: { ...prev.columns, [sourceCol.id]: { ...sourceCol, subjectIds: newSubjectIds } } }));
            return;
        }

        const sourceIds = Array.from(sourceCol.subjectIds);
        sourceIds.splice(source.index, 1);
        const destIds = Array.from(destCol.subjectIds);
        destIds.splice(destination.index, 0, draggableId);

        setData(prev => ({
            ...prev,
            columns: {
                ...prev.columns,
                [sourceCol.id]: { ...sourceCol, subjectIds: sourceIds },
                [destCol.id]: { ...destCol, subjectIds: destIds }
            }
        }));

        // Immediately update global subjects
        const newFaculty = destCol.id === 'unassigned' ? '' : destCol.title;
        setSubjects(prev => prev.map(s => s.code === draggableId ? { ...s, faculty: newFaculty } : s));
        addNotification('Subject Assigned', `${data.subjects[draggableId].name} assigned to ${newFaculty || 'Unassigned'}`, 'success');
    };

    return (
        <div className="page-content">
            <DragDropContext onDragEnd={onDragEnd}>
                <div className="panels-grid" style={{ gridTemplateColumns: '1fr 2fr' }}>
                    <div className="panel">
                        <div className="panel-header">
                            <div>
                                <h3 className="panel-title">Unassigned Subjects</h3>
                                <p className="panel-subtitle">Drag to a faculty member</p>
                            </div>
                        </div>
                        <Droppable droppableId="unassigned">
                            {(provided, snapshot) => (
                                <div
                                    ref={provided.innerRef}
                                    {...provided.droppableProps}
                                    className="subject-list"
                                    style={{ background: snapshot.isDraggingOver ? 'var(--primary-subtle)' : 'transparent' }}
                                >
                                    {data.columns['unassigned'].subjectIds.map((subjectId, index) => {
                                        const subject = data.subjects[subjectId];
                                        return (
                                            <Draggable key={subject.id} draggableId={subject.id} index={index}>
                                                {(provided, snapshot) => (
                                                    <div
                                                        ref={provided.innerRef}
                                                        {...provided.draggableProps}
                                                        {...provided.dragHandleProps}
                                                        className="subject-item"
                                                        style={{
                                                            ...provided.draggableProps.style,
                                                            background: snapshot.isDragging ? 'var(--primary-light)' : 'var(--bg-secondary)',
                                                        }}
                                                    >
                                                        {subject.name}
                                                    </div>
                                                )}
                                            </Draggable>
                                        );
                                    })}
                                    {provided.placeholder}
                                </div>
                            )}
                        </Droppable>
                    </div>

                    <div className="panel">
                         <div className="panel-header">
                            <div>
                                <h3 className="panel-title">Faculty Assignments</h3>
                                <p className="panel-subtitle">Drop subjects here</p>
                            </div>
                        </div>
                        <div className="faculty-assignment-grid">
                            {data.columnOrder.slice(1).map(columnId => {
                                const column = data.columns[columnId];
                                const subjects = column.subjectIds.map(subjectId => data.subjects[subjectId]);
                                return (
                                    <div key={column.id} className="faculty-assignment-card">
                                        <h4 className="faculty-name">{column.title}</h4>
                                        <Droppable droppableId={column.id}>
                                            {(provided, snapshot) => (
                                                <div
                                                    ref={provided.innerRef}
                                                    {...provided.droppableProps}
                                                    className="subject-drop-zone"
                                                    style={{ background: snapshot.isDraggingOver ? 'var(--accent-green-light)' : 'var(--bg-secondary)' }}
                                                >
                                                    {subjects.map((subject, index) => (
                                                        <Draggable key={subject.id} draggableId={subject.id} index={index}>
                                                            {(provided) => (
                                                                <div
                                                                    ref={provided.innerRef}
                                                                    {...provided.draggableProps}
                                                                    {...provided.dragHandleProps}
                                                                    className="subject-item assigned"
                                                                >
                                                                    {subject.name}
                                                                </div>
                                                            )}
                                                        </Draggable>
                                                    ))}
                                                    {provided.placeholder}
                                                </div>
                                            )}
                                        </Droppable>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </DragDropContext>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// SUBJECTS PAGE (Faculty/HOD)
// ═══════════════════════════════════════════════════════════════════════════

function SubjectsPage({ role, subjects, setSubjects, getAuthToken }) {
    const { addNotification } = useNotifications();
    const { roles } = useAuth();
    const [uploadStatus, setUploadStatus] = useState(null);
    const fileInputRef = useRef(null);
    const [uploadContext, setUploadContext] = useState(null);

    const handleUploadClick = (code, type) => {
        setUploadContext({ code, type });
        if (fileInputRef.current) fileInputRef.current.click();
    };

    const handleFileChange = async (e) => {
        const file = e.target.files[0];
        if (!file || !uploadContext) return;

        setUploadStatus({ code: uploadContext.code, type: uploadContext.type });
        const formData = new FormData();
        formData.append('resource', file);
        formData.append('subjectCode', uploadContext.code);
        formData.append('type', uploadContext.type);
        formData.append('title', `${uploadContext.type}: ${file.name}`);

        try {
            const token = await getAuthToken();
            const response = await fetch('http://localhost:4000/api/resources/upload', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });
            const result = await response.json();
            
            if (result.success) {
                addNotification('Success', `${uploadContext.type} uploaded successfully`, 'success');
                setSubjects(prev => prev.map(s => {
                    if (s.code === uploadContext.code) {
                        const listKey = uploadContext.type === 'Assignment' ? 'assignments' : 'resources';
                        return { ...s, [listKey]: [...(s[listKey] || []), result.data] };
                    }
                    return s;
                }));
            }
        } catch (err) {
            console.error("Upload error:", err);
            addNotification('Error', 'Failed to upload file', 'error');
        } finally {
            setUploadStatus(null);
            setUploadContext(null);
            e.target.value = '';
        }
    };

    const onDragEnd = (result) => {
        const { destination, source } = result;
        if (!destination) return;
        if (destination.droppableId === source.droppableId && destination.index === source.index) return;

        const newSubjects = Array.from(subjects);
        const [reorderedItem] = newSubjects.splice(source.index, 1);
        newSubjects.splice(destination.index, 0, reorderedItem);
        setSubjects(newSubjects);
    };

    return (
        <div className="page-content">
            <div className="panel">
                <div className="panel-header">
                    <div>
                        <h3 className="panel-title">All Subjects</h3>
                        <p className="panel-subtitle">Current semester - Upload study materials</p>
                    </div>
                </div>
                <DragDropContext onDragEnd={onDragEnd}>
                    <table className="workload-table">
                        <thead>
                            <tr>
                                <th style={{ width: '50px' }}></th>
                                <th>Code</th>
                                <th>Subject Name</th>
                                <th>Resources</th>
                                <th>Assignments</th>
                                {role !== roles.STUDENT && <th>Actions</th>}
                            </tr>
                        </thead>
                        <Droppable droppableId="subjects">
                            {(provided) => (
                                <tbody {...provided.droppableProps} ref={provided.innerRef}>
                                    {subjects.map((subject, i) => (
                                        <Draggable key={subject.code} draggableId={subject.code} index={i}>
                                            {(provided) => (
                                                <tr ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}>
                                                    <td><Icon name="menu" size={20} className="drag-handle" /></td>
                                                    <td><strong>{subject.code}</strong></td>
                                                    <td>{subject.subject || subject.name}</td>
                                                    <td>{(subject.resources || []).length} items</td>
                                                    <td>{(subject.assignments || []).length} items</td>
                                                    {role !== roles.STUDENT && (
                                                        <td>
                                                            <div className="flex gap-2">
                                                                <button 
                                                                    className="room-btn edit" 
                                                                    onClick={() => handleUploadClick(subject.code, 'Assignment')}
                                                                    disabled={uploadStatus?.code === subject.code && uploadStatus?.type === 'Assignment'}
                                                                >
                                                                    <Icon name="upload" size={16} />
                                                                    {uploadStatus?.code === subject.code && uploadStatus?.type === 'Assignment' ? 'Uploading...' : 'Assignment'}
                                                                </button>
                                                                <button 
                                                                    className="room-btn toggle" 
                                                                    onClick={() => handleUploadClick(subject.code, 'Resource')}
                                                                    disabled={uploadStatus?.code === subject.code && uploadStatus?.type === 'Resource'}
                                                                >
                                                                    <Icon name="file" size={16} />
                                                                    {uploadStatus?.code === subject.code && uploadStatus?.type === 'Resource' ? 'Uploading...' : 'Resource'}
                                                                </button>
                                                            </div>
                                                        </td>
                                                    )}
                                                </tr>
                                            )}
                                        </Draggable>
                                    ))}
                                    {provided.placeholder}
                                </tbody>
                            )}
                        </Droppable>
                    </table>
                </DragDropContext>
            </div>
            <input 
                type="file" 
                ref={fileInputRef} 
                style={{ display: 'none' }} 
                accept=".pdf,.doc,.docx,.ppt,.pptx,.txt"
                onChange={handleFileChange}
            />
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTO SCHEDULER PAGE
// ═══════════════════════════════════════════════════════════════════════════

function SchedulerPage() {
    const [isRunning, setIsRunning] = useState(false);
    const [progress, setProgress] = useState(0);

    const runScheduler = () => {
        setIsRunning(true);
        setProgress(0);
        const interval = setInterval(() => {
            setProgress(prev => {
                if (prev >= 100) {
                    clearInterval(interval);
                    setIsRunning(false);
                    return 100;
                }
                return prev + 10;
            });
        }, 500);
    };

    return (
        <div className="page-content">
            <div className="panels-grid">
                <div className="panel">
                    <div className="panel-header">
                        <div>
                            <h3 className="panel-title">Auto Scheduler</h3>
                            <p className="panel-subtitle">AI-powered schedule optimization</p>
                        </div>
                    </div>
                    <p className="mb-4 text-muted">
                        The auto scheduler uses AI to optimize your timetable based on:
                    </p>
                    <ul style={{ marginBottom: '24px', paddingLeft: '20px', color: 'var(--text-muted)' }}>
                        <li>Faculty availability and preferences</li>
                        <li>Room capacity and equipment needs</li>
                        <li>Student batch sizes</li>
                        <li>Optimal learning sequences</li>
                        <li>Conflict avoidance</li>
                    </ul>
                    <button
                        className="login-btn"
                        onClick={runScheduler}
                        disabled={isRunning}
                    >
                        {isRunning ? 'Optimizing...' : 'Run Auto Scheduler'}
                    </button>
                </div>

                <div className="panel">
                    <div className="panel-header">
                        <div>
                            <h3 className="panel-title">Optimization Progress</h3>
                            <p className="panel-subtitle">Current optimization run</p>
                        </div>
                    </div>
                    <div className="progress-container">
                        <div className="progress-label">
                            <span>Progress</span>
                            <span>{progress}%</span>
                        </div>
                        <div className="progress-bar" style={{ height: '16px' }}>
                            <div className="progress-bar-fill" style={{ width: `${progress}%` }}></div>
                        </div>
                    </div>
                    {progress === 100 && (
                        <div className="suggestion-card success mt-4">
                            <div className="suggestion-header">
                                <div className="suggestion-icon success">
                                    <Icon name="check" size={18} />
                                </div>
                                <span className="suggestion-title">Optimization Complete</span>
                            </div>
                            <p className="suggestion-body">
                                The scheduler has found an optimal configuration. Review and apply the changes.
                            </p>
                            <button className="room-btn edit mt-4">View Changes</button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// REVISION PAGE (Student)
// ═══════════════════════════════════════════════════════════════════════════

function RevisionPage({ subjects, getAuthToken }) {
    const [viewItem, setViewItem] = useState(null);
    const { addNotification } = useNotifications();

    // Flatten all resources and assignments for display
    const items = useMemo(() => {
        const all = [];
        subjects.forEach(s => {
            const subjectName = s.subject || s.name || 'Unknown Subject';
            if (s.resources) {
                s.resources.forEach(r => all.push({ ...r, subjectName }));
            }
            if (s.assignments) {
                s.assignments.forEach(a => all.push({ ...a, subjectName }));
            }
        });
        
        return all;
    }, [subjects]);

    const handleDownload = async (item) => {
        if (!item.file_name) return;
        
        try {
            const token = await getAuthToken();
            const response = await fetch(`http://localhost:4000/api/resources/download/${item.file_name}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (!response.ok) throw new Error('Download failed');
            
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = item.title || item.file_name;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (err) {
            console.error("Download error:", err);
            addNotification('Error', 'Failed to download file', 'error');
        }
    };

    return (
        <div className="page-content">
            {/* View Modal */}
            {viewItem && (
                <div
                    style={{
                        position: 'fixed', inset: 0, zIndex: 1000,
                        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: '24px'
                    }}
                    onClick={() => setViewItem(null)}
                >
                    <div
                        style={{
                            background: 'var(--bg-card)', borderRadius: '16px',
                            padding: '32px', maxWidth: '580px', width: '100%',
                            boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
                            border: '1px solid var(--border)'
                        }}
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Modal Header */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
                            <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
                                <div className={`card-icon ${viewItem.type === 'Assignment' ? 'orange' : 'primary'}`} style={{ width: '44px', height: '44px', flexShrink: 0 }}>
                                    <Icon name={viewItem.type === 'Assignment' ? 'upload' : 'book'} size={22} />
                                </div>
                                <div>
                                    <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>{viewItem.title}</h3>
                                    <p style={{ margin: '2px 0 0', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                                        {viewItem.subjectName} &bull; <span style={{ color: viewItem.type === 'Assignment' ? 'var(--accent-orange)' : 'var(--primary)', fontWeight: 600 }}>{viewItem.type}</span>
                                    </p>
                                </div>
                            </div>
                            <button
                                className="room-btn toggle"
                                style={{ padding: '6px 10px' }}
                                onClick={() => setViewItem(null)}
                            >
                                <Icon name="x" size={18} />
                            </button>
                        </div>

                        {/* Date */}
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', color: 'var(--text-muted)', fontSize: '0.8125rem', marginBottom: '20px' }}>
                            <Icon name="calendar" size={14} />
                            {viewItem.date || 'No date'}
                        </div>

                        {/* Content area */}
                        <div style={{
                            background: 'var(--bg-secondary)', borderRadius: '10px',
                            padding: '20px', minHeight: '120px',
                            border: '1px solid var(--border)', lineHeight: '1.7'
                        }}>
                            {viewItem.file_name ? (
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '20px 0', color: 'var(--text-primary)' }}>
                                    <Icon name="file" size={36} />
                                    <p style={{ margin: 0, fontWeight: 600 }}>{viewItem.title}</p>
                                    <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-muted)' }}>{viewItem.size}</p>
                                </div>
                            ) : viewItem.content ? (
                                <p style={{ margin: 0, color: 'var(--text-primary)' }}>{viewItem.content}</p>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '20px 0', color: 'var(--text-muted)' }}>
                                    <Icon name="file" size={36} />
                                    <p style={{ margin: 0, fontWeight: 600 }}>No details available</p>
                                </div>
                            )}
                        </div>

                        {/* Actions */}
                        <div style={{ display: 'flex', gap: '12px', marginTop: '20px', justifyContent: 'flex-end' }}>
                            {viewItem.file_name && (
                                <button className="room-btn edit" onClick={() => handleDownload(viewItem)}>
                                    <Icon name="download" size={16} />
                                    Download
                                </button>
                            )}
                            <button className="room-btn toggle" onClick={() => setViewItem(null)}>Close</button>
                        </div>
                    </div>
                </div>
            )}

            <div className="panel">
                <div className="panel-header">
                    <div>
                        <h3 className="panel-title">Study Materials</h3>
                        <p className="panel-subtitle">{items.length} item{items.length !== 1 ? 's' : ''} &bull; Notes and assignments from faculty</p>
                    </div>
                </div>
                {items.length > 0 ? (
                    <div className="flex flex-col gap-4">
                        {items.map((item) => (
                            <div key={item.id} className="today-class-item">
                                <div className={`card-icon ${item.type === 'Assignment' ? 'orange' : 'primary'}`} style={{ width: '40px', height: '40px', flexShrink: 0 }}>
                                    <Icon name={item.type === 'Assignment' ? 'upload' : 'book'} size={20} />
                                </div>
                                <div className="class-details">
                                    <div className="class-name">{item.subjectName}</div>
                                    <div className="class-meta">{item.title} &bull; {item.type}</div>
                                </div>
                                <div className="text-muted" style={{ fontSize: '0.8125rem', marginRight: '16px', flexShrink: 0 }}>{item.date}</div>
                                <button className="room-btn edit" onClick={() => setViewItem(item)}>
                                    <Icon name="file" size={15} />
                                    View
                                </button>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                        <Icon name="book-open" size={48} style={{ opacity: 0.2, marginBottom: '16px' }} />
                        <p>No study materials uploaded for this semester yet.</p>
                    </div>
                )}
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN APP COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

function App() {
    const { user, isLoading } = useAuth();
    const { session } = useClerk();
    const { addNotification } = useNotifications();
    const [currentPage, setCurrentPage] = useState('dashboard');
    const [sidebarOpen, setSidebarOpen] = useState(false);

    // Get Auth Token
    const getAuthToken = async () => {
        if (!session) return null;
        return await session.getToken();
    };

    // Student year setup
    const [studentYear, setStudentYear] = useState(() => {
        const y = localStorage.getItem('smarttable-student-year');
        return y ? parseInt(y) : null;
    });
    const [yearConfirmedThisSession, setYearConfirmedThisSession] = useState(
        () => !!sessionStorage.getItem('smarttable-year-session')
    );
    const yearSemesters = studentYear ? YEAR_DATA.find(y => y.year === studentYear)?.semesters : null;

    const handleYearSelect = (year, semesters) => {
        setStudentYear(year);
        setYearConfirmedThisSession(true);
        localStorage.setItem('smarttable-student-year', year);
        sessionStorage.setItem('smarttable-year-session', '1');
        const firstSem = semesters[0];
        setSemester(firstSem);
        updateProfile({ year, semester: firstSem });
    };

    const [semester, setSemester] = useState(() => localStorage.getItem('smarttable-semester') || 'Semester 1');
    const [section, setSection] = useState(() => localStorage.getItem('smarttable-section') || 'Section A');

    useEffect(() => { 
        localStorage.setItem('smarttable-semester', semester);
    }, [semester]);
    
    useEffect(() => { 
        localStorage.setItem('smarttable-section', section);
    }, [section]);

    // ═══════════════════════════════════════════════════════════════════════════
    // PROFILE SYNC LOGIC
    // ═══════════════════════════════════════════════════════════════════════════
    useEffect(() => {
        if (!user) return;

        const syncProfile = async () => {
            try {
                const response = await fetch(`http://localhost:4000/api/profile/${user.email}`);
                const result = await response.json();

                if (result.success && result.data) {
                    const profile = result.data;
                    if (profile.year) setStudentYear(profile.year);
                    if (profile.semester) setSemester(profile.semester);
                    if (profile.section) setSection(profile.section);
                    setYearConfirmedThisSession(true);
                } else {
                    updateProfile({ 
                        full_name: user.name, 
                        role: user.role, 
                        year: studentYear, 
                        section, 
                        semester 
                    });
                }
            } catch (err) {
                console.error("Profile sync error:", err);
            }
        };

        syncProfile();
    }, [user]);

    const updateProfile = async (updates) => {
        if (!user) return;
        try {
            await fetch('http://localhost:4000/api/profile/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: user.email, ...updates })
            });
        } catch (err) {
            console.error("Profile update error:", err);
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // SMART NOTIFICATION SCHEDULER
    // ═══════════════════════════════════════════════════════════════════════════
    const lastRevisionReminder = useRef(localStorage.getItem('last-revision-reminder'));
    const sentReminders = useRef(new Set());

    useEffect(() => {
        if (!user || user.role !== 'student') return;

        const checkSchedule = () => {
            const now = new Date();
            const currentHour = now.getHours();
            const todayStr = now.toDateString();

            // 1. Daily Revision Reminder (triggered once per day after 9 AM)
            if (currentHour >= 9 && lastRevisionReminder.current !== todayStr) {
                addNotification('Daily Revision', 'Morning! Ready for a quick 5-minute revision test?', 'info');
                localStorage.setItem('last-revision-reminder', todayStr);
                lastRevisionReminder.current = todayStr;
            }

            // 2. Upcoming Lecture Reminder (5 mins before)
            const classes = SEMESTER_DATA[semester]?.todayClasses || [];
            classes.forEach(cls => {
                const classTime = new Date(now);
                classTime.setHours(cls.hour, cls.minute, 0, 0);
                const diffMins = Math.floor((classTime - now) / 60000);

                if (diffMins === 5 && !sentReminders.current.has(`${cls.subject}-${cls.time}`)) {
                    addNotification('Upcoming Lecture', `${cls.subject} starts in 5 minutes in ${cls.room}`, 'warning');
                    sentReminders.current.add(`${cls.subject}-${cls.time}`);
                }
            });

            // 3. Assignment & Attendance Check (4 PM)
            if (currentHour === 16 && !sentReminders.current.has(`daily-check-${todayStr}`)) {
                addNotification('Daily Recap', 'Check your attendance and pending assignments for the day.', 'success');
                sentReminders.current.add(`daily-check-${todayStr}`);
            }
        };

        const interval = setInterval(checkSchedule, 60000);
        checkSchedule();
        return () => clearInterval(interval);
    }, [semester, user, addNotification]);

    // Centralized subjects state for synchronization across all components
    const [subjects, setSubjects] = useState(() => {
        try {
            const stored = localStorage.getItem('smarttable-subjects');
            if (stored) {
                const parsed = JSON.parse(stored);
                if (parsed && parsed.length > 0) return parsed;
            }
            
            // Fallback to SEMESTER_DATA or original static list
            return SEMESTER_DATA[semester]?.subjects || [
                { id: 'sub-1', code: 'CS301', subject: 'Data Structures', type: 'lecture', faculty: 'Dr. Sarah Johnson', room: 'A-101', student: 'CS301 - 55 students', resources: [], assignments: [] },
                { id: 'sub-2', code: 'CS302', subject: 'Database Systems', type: 'lecture', faculty: 'Dr. Sarah Johnson', room: 'A-102', student: 'CS302 - 52 students', resources: [], assignments: [] },
                { id: 'sub-3', code: 'CS303', subject: 'Web Development', type: 'lecture', faculty: 'Ms. Lisa Wong', room: 'B-101', student: 'CS303 - 48 students', resources: [], assignments: [] },
                { id: 'sub-4', code: 'CS304', subject: 'Operating Systems', type: 'lecture', faculty: 'Dr. Robert Kim', room: 'A-103', student: 'CS301 - 55 students', resources: [], assignments: [] },
                { id: 'sub-5', code: 'CS401', subject: 'Machine Learning', type: 'lab', faculty: 'Prof. Michael Chen', room: 'Lab-3', student: 'CS401 - 30 students', resources: [], assignments: [] },
                { id: 'sub-6', code: 'MA301', subject: 'Discrete Mathematics', type: 'tutorial', faculty: 'Dr. Rachel Park', room: 'B-202', student: 'CS301 - 25 students', resources: [], assignments: [] },
            ];
        } catch (e) {
            return [];
        }
    });

    // Update subjects whenever semester changes
    useEffect(() => {
        if (SEMESTER_DATA[semester]) {
            setSubjects(SEMESTER_DATA[semester].subjects);
        }
    }, [semester]);

    // Write to storage whenever subjects change (ignoring empty)
    useEffect(() => {
        if (subjects && subjects.length > 0) {
            localStorage.setItem('smarttable-subjects', JSON.stringify(subjects));
        }
    }, [subjects]);

    // Fetch all resources and assignments to sync with subjects
    useEffect(() => {
        if (!user || !session) return;

        const fetchResources = async () => {
            try {
                const token = await session.getToken();
                const response = await fetch('http://localhost:4000/api/resources/all', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const result = await response.json();

                if (result.success && result.data) {
                    setSubjects(prev => prev.map(subject => {
                        const subjectResources = result.data.filter(r => r.subject_code === subject.code && r.type === 'Resource');
                        const subjectAssignments = result.data.filter(r => r.subject_code === subject.code && r.type === 'Assignment');
                        
                        return {
                            ...subject,
                            resources: subjectResources.map(r => ({ ...r, id: r.id, title: r.title, date: r.date })),
                            assignments: subjectAssignments.map(r => ({ ...r, id: r.id, title: r.title, date: r.date }))
                        };
                    }));
                }
            } catch (err) {
                console.error("Fetch resources error:", err);
            }
        };

        fetchResources();
    }, [user, session]);

    if (isLoading) {
        return (
            <div className="login-page">
                <div className="login-card">
                    <div className="skeleton skeleton-card"></div>
                    <div className="skeleton skeleton-text long mt-4"></div>
                    <div className="skeleton skeleton-text short mt-2"></div>
                </div>
            </div>
        );
    }

    if (!user) {
        return <LoginPage />;
    }

    const renderPage = () => {
        // Student pages
        if (user.role === 'student') {
            switch (currentPage) {
                case 'dashboard': return <StudentDashboard semester={semester} getAuthToken={getAuthToken} />;
                case 'timetable': return <TimetablePage role={user.role} subjects={subjects} setSubjects={setSubjects} semester={semester} getAuthToken={getAuthToken} />;
                case 'updates': return <UpdatesPage />;
                case 'mcq': return <MCQPage subjects={subjects} />;
                case 'revision': return <RevisionPage subjects={subjects} getAuthToken={getAuthToken} />;
                case 'progress': return <ProgressPage getAuthToken={getAuthToken} />;
                case 'settings': return <SettingsPage studentYear={studentYear} onChangeYear={() => { setYearConfirmedThisSession(false); sessionStorage.removeItem('smarttable-year-session'); }} />;
                default: return <StudentDashboard semester={semester} />;
            }
        }

        // Faculty/HOD pages
        switch (currentPage) {
            case 'dashboard': return <FacultyDashboard user={user} subjects={subjects} />;
            case 'timetable': return <TimetablePage role={user.role} subjects={subjects} setSubjects={setSubjects} semester={semester} getAuthToken={getAuthToken} />;
            case 'scheduler': return <SchedulerPage />;
            case 'rooms': return <RoomsPage role={user.role} />;
            case 'subjects': return <SubjectsPage role={user.role} subjects={subjects} setSubjects={setSubjects} getAuthToken={getAuthToken} />;
            case 'attendance': return <FacultyAttendancePage getAuthToken={getAuthToken} />;
            case 'settings': return <SettingsPage studentYear={studentYear} onChangeYear={() => { setYearConfirmedThisSession(false); sessionStorage.removeItem('smarttable-year-session'); }} />;
            // HOD specific
            case 'analytics': return user.role === 'hod' ? <AnalyticsPage /> : <FacultyDashboard user={user} subjects={subjects} />;
            case 'workload': return user.role === 'hod' ? <WorkloadPage /> : <FacultyDashboard user={user} subjects={subjects} />;
            case 'subjectAssignment': return user.role === 'hod' ? <SubjectAssignmentPage subjects={subjects} setSubjects={setSubjects} /> : <FacultyDashboard user={user} subjects={subjects} />;
            case 'roomControl': return user.role === 'hod' ? <RoomControlPage /> : <RoomsPage role={user.role} />;
            case 'conflicts': return user.role === 'hod' ? <ConflictsPage /> : <FacultyDashboard user={user} subjects={subjects} />;
            case 'reports': return user.role === 'hod' ? <ReportsPage /> : <FacultyDashboard user={user} subjects={subjects} />;
            default: return <FacultyDashboard user={user} subjects={subjects} />;
        }
    };

    return (
        <div className="app-container">
            {/* Year Setup Modal — shown for students on every new login session */}
            {user.role === 'student' && !yearConfirmedThisSession && (
                <YearSetupModal onSelect={handleYearSelect} defaultYear={studentYear} />
            )}

            <Sidebar
                isOpen={sidebarOpen}
                onClose={() => setSidebarOpen(false)}
                currentPage={currentPage}
                onNavigate={setCurrentPage}
                role={user.role}
            />

            <main className="main-content">
                <Header
                    currentPage={currentPage}
                    onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
                    role={user.role}
                    semester={semester}
                    setSemester={(val) => { setSemester(val); updateProfile({ semester: val }); }}
                    section={section}
                    setSection={(val) => { setSection(val); updateProfile({ section: val }); }}
                    yearSemesters={yearSemesters}
                />
                {renderPage()}
            </main>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// ROOT RENDER
// ═══════════════════════════════════════════════════════════════════════════

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!PUBLISHABLE_KEY) {
    console.error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env");
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/">
        <ThemeProvider>
            <AuthProvider>
                <NotificationProvider>
                    <App />
                </NotificationProvider>
            </AuthProvider>
        </ThemeProvider>
    </ClerkProvider>
);
