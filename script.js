const App = {
    audioCtx: null,
    analyser: null,
    buf: new Float32Array(2048),
    isPaused: false,
    
    // Smoothing Buffers
    pitchHistory: [], 
    maxHistory: 150,
    smoothingWindow: [],
    smoothingSize: 6, // Increase for even more stability

    // Range Data
    minFreq: Infinity, maxFreq: -Infinity,

    // Metronome
    isMetroOn: false, tempo: 120,

    // Config
    refA4: 440, threshold: 0.015, notation: 'english',
    notes: {
        english: ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'],
        solfege: ['Do','Do#','Re','Re#','Mi','Fa','Fa#','Sol','Sol#','La','La#','Si']
    },

    init() {
        this.setupNavigation();
        this.bindEvents();
        window.addEventListener('resize', () => this.resizeCanvas());
    },

    bindEvents() {
        document.getElementById('start-app-btn').onclick = () => this.startEngine();
        
        document.getElementById('freeze-btn').onclick = () => {
            this.isPaused = !this.isPaused;
            const icon = document.querySelector('#freeze-btn i');
            icon.setAttribute('data-lucide', this.isPaused ? 'play' : 'pause');
            lucide.createIcons();
        };

        // Metronome logic
        document.getElementById('bpm-slider').oninput = (e) => {
            this.tempo = e.target.value;
            document.getElementById('bpm-value').innerText = this.tempo;
        };

        document.getElementById('metro-toggle').onclick = (e) => {
            this.isMetroOn = !this.isMetroOn;
            e.target.innerText = this.isMetroOn ? 'Stop Metronome' : 'Start Metronome';
            if(this.isMetroOn) this.playTick();
        };

        // Reset tracking
        document.getElementById('reset-range').onclick = () => {
            this.minFreq = Infinity; this.maxFreq = -Infinity;
            document.getElementById('range-low').innerText = '--';
            document.getElementById('range-high').innerText = '--';
            this.pitchHistory = [];
        };

        // Settings updates
        document.getElementById('setting-notation').onchange = (e) => this.notation = e.target.value;
        document.getElementById('setting-ref-pitch').onchange = (e) => this.refA4 = parseFloat(e.target.value) || 440;
        document.getElementById('setting-threshold').oninput = (e) => this.threshold = parseFloat(e.target.value);
    },

    async startEngine() {
        try {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const source = this.audioCtx.createMediaStreamSource(stream);
            this.analyser = this.audioCtx.createAnalyser();
            this.analyser.fftSize = 2048;
            source.connect(this.analyser);
            
            document.getElementById('modal-permission').style.display = 'none';
            this.resizeCanvas();
            this.audioLoop();
        } catch (err) {
            alert("Please allow microphone access to use the tuner.");
        }
    },

    playTick() {
        if(!this.isMetroOn) return;
        const osc = this.audioCtx.createOscillator();
        const g = this.audioCtx.createGain();
        osc.frequency.setValueAtTime(1000, this.audioCtx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.1);
        osc.connect(g); g.connect(this.audioCtx.destination);
        osc.start(); osc.stop(this.audioCtx.currentTime + 0.1);
        setTimeout(() => this.playTick(), (60 / this.tempo) * 1000);
    },

    // Autocorrelation Pitch Detection
    detectPitch(data, sr) {
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        if (Math.sqrt(sum / data.length) < this.threshold) return -1;

        let c = new Float32Array(data.length).fill(0);
        for (let i = 0; i < data.length; i++) {
            for (let j = 0; j < data.length - i; j++) c[i] += data[j] * data[j + i];
        }
        let d = 0; while (c[d] > c[d + 1]) d++;
        let maxVal = -1, maxPos = -1;
        for (let i = d; i < data.length; i++) {
            if (c[i] > maxVal) { maxVal = c[i]; maxPos = i; }
        }
        return sr / maxPos;
    },

    drawHistogram() {
        const canvas = document.getElementById('history-canvas');
        if(!canvas) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        // Draw Vertical Note Guides (Piano Roll Style)
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1;
        ctx.font = '10px sans-serif';
        ctx.fillStyle = '#475569';
        
        // Show 3 octaves (C3 to C6)
        for (let m = 48; m <= 84; m += 1) {
            const y = h - ((m - 48) / 36) * h;
            if (m % 12 === 0) { // Highlight C notes
                ctx.strokeStyle = '#334155';
                ctx.fillText(this.midiToNoteName(m), 5, y - 5);
                ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
            }
        }

        if (this.pitchHistory.length < 2) return;

        // Draw Pitch Path
        ctx.strokeStyle = '#0ea5e9';
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.shadowBlur = 12;
        ctx.shadowColor = '#0ea5e9';
        ctx.beginPath();

        const step = w / this.maxHistory;
        this.pitchHistory.forEach((f, i) => {
            const midi = 12 * Math.log2(f / 440) + 69;
            const x = i * step;
            const y = h - ((midi - 48) / 36) * h;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.shadowBlur = 0;
    },

    midiToNoteName(midi) {
        const names = this.notes[this.notation];
        return names[midi % 12] + (Math.floor(midi / 12) - 1);
    },

    audioLoop() {
        if (!this.isPaused) {
            this.analyser.getFloatTimeDomainData(this.buf);
            const raw = this.detectPitch(this.buf, this.audioCtx.sampleRate);

            if (raw !== -1 && raw < 2500) {
                // Apply stability smoothing
                this.smoothingWindow.push(raw);
                if (this.smoothingWindow.length > this.smoothingSize) this.smoothingWindow.shift();
                const freq = this.smoothingWindow.reduce((a, b) => a + b) / this.smoothingWindow.length;

                // Pitch Math
                const h = Math.round(12 * Math.log2(freq / this.refA4));
                const noteIdx = (h + 9) % 12;
                const noteName = this.notes[this.notation][noteIdx < 0 ? noteIdx + 12 : noteIdx];
                const oct = Math.floor((h + 9) / 12) + 4;
                const cents = Math.floor(1200 * Math.log2(freq / (this.refA4 * Math.pow(2, h/12))));

                // Main Display Update
                document.getElementById('note-name').innerText = noteName;
                document.getElementById('note-octave').innerText = oct;
                document.getElementById('frequency').innerText = freq.toFixed(1);
                
                // Needle Physics (Capped at -50/+50)
                const needle = document.getElementById('tuner-needle');
                const percent = Math.max(-45, Math.min(45, (cents / 50) * 45)); 
                needle.style.transform = `translateX(${percent}vw)`;

                // Tracking
                this.pitchHistory.push(freq);
                if (this.pitchHistory.length > this.maxHistory) this.pitchHistory.shift();
                this.drawHistogram();

                if (freq < this.minFreq) { 
                    this.minFreq = freq; 
                    document.getElementById('range-low').innerText = noteName+oct; 
                }
                if (freq > this.maxFreq) { 
                    this.maxFreq = freq; 
                    document.getElementById('range-high').innerText = noteName+oct; 
                }
            }
        }
        requestAnimationFrame(() => this.audioLoop());
    },

    resizeCanvas() {
        const c = document.getElementById('history-canvas');
        if (c) {
            c.width = c.clientWidth;
            c.height = c.clientHeight;
        }
    },

    setupNavigation() {
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('.nav-item, .view').forEach(el => el.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(`view-${btn.dataset.view}`).classList.add('active');
                if (btn.dataset.view === 'analyze') {
                    setTimeout(() => this.resizeCanvas(), 50);
                }
            };
        });
    }
};

App.init();
