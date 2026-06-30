/* ============ Simple Games — profiles & scores storage ============ */
(function () {
    "use strict";

    const KEY = "simple-games-data-v1";

    function load() {
        try {
            const raw = localStorage.getItem(KEY);
            if (raw) {
                const data = JSON.parse(raw);
                if (data && Array.isArray(data.profiles)) return data;
            }
        } catch (err) {
            console.warn("Storage read failed, starting fresh.", err);
        }
        return { profiles: [], activeProfileId: null };
    }

    function save() {
        try {
            localStorage.setItem(KEY, JSON.stringify(state));
        } catch (err) {
            console.warn("Storage write failed.", err);
        }
    }

    let state = load();

    function uid() {
        return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    /** Returns the score map for the profile's current mode, creating it if needed. */
    function scoreMap(profile) {
        if (profile.kids) {
            if (!profile.kidsScores) profile.kidsScores = {};
            return profile.kidsScores;
        }
        if (!profile.scores) profile.scores = {};
        return profile.scores;
    }

    const Storage = {
        getProfiles() {
            return state.profiles.slice();
        },

        getProfile(id) {
            return state.profiles.find(p => p.id === id) || null;
        },

        getActiveProfile() {
            return this.getProfile(state.activeProfileId);
        },

        setActiveProfile(id) {
            state.activeProfileId = id;
            save();
        },

        clearActiveProfile() {
            state.activeProfileId = null;
            save();
        },

        createProfile(name, avatar, kids) {
            const profile = {
                id: uid(),
                name: name,
                avatar: avatar,
                kids: !!kids,
                scores: {},
                kidsScores: {},
                createdAt: Date.now()
            };
            state.profiles.push(profile);
            save();
            return profile;
        },

        updateProfile(id, name, avatar, kids) {
            const profile = this.getProfile(id);
            if (!profile) return null;
            profile.name = name;
            profile.avatar = avatar;
            if (kids !== undefined) profile.kids = !!kids;
            save();
            return profile;
        },

        isKidsMode(id) {
            const profile = this.getProfile(id);
            return !!(profile && profile.kids);
        },

        setKidsMode(id, on) {
            const profile = this.getProfile(id);
            if (!profile) return;
            profile.kids = !!on;
            save();
        },

        deleteProfile(id) {
            state.profiles = state.profiles.filter(p => p.id !== id);
            if (state.activeProfileId === id) state.activeProfileId = null;
            save();
        },

        getBestScore(profileId, gameId) {
            const profile = this.getProfile(profileId);
            if (!profile) return 0;
            const scores = scoreMap(profile);
            return scores[gameId] || 0;
        },

        /** Returns a copy of the score map for the profile's current mode. */
        getScores(profileId) {
            const profile = this.getProfile(profileId);
            if (!profile) return {};
            return Object.assign({}, scoreMap(profile));
        },

        /** Returns true if this is a new best score. */
        submitScore(profileId, gameId, score) {
            const profile = this.getProfile(profileId);
            if (!profile) return false;
            const scores = scoreMap(profile);
            const best = scores[gameId] || 0;
            if (score > best) {
                scores[gameId] = score;
                save();
                return true;
            }
            return false;
        }
    };

    window.SGStorage = Storage;
})();
