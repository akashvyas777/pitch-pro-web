const App = {
    audioCtx: null,
    analyser: null,
    // Increased buffer for better low-frequency resolution
    buf: new Float32Array(4096), 
    isPaused: false,
    
    pitchHistory: [], 
    maxHistory: 150,
    
    // Advanced Stability
    smoothingWindow: [],
    smoothingSize: 10, // Larger window for deep notes
    currentCenterMidi: 60,

    minFreq: Infinity, maxFreq: -Infinity,
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
        document.getElementById('bpm-slider').oninput = (e) => {
            this.tempo = e.target.value;
            document.getElementById('bpm-value').innerText = this.tempo;
        };
        document.getElementById('metro-toggle').onclick = (e) => {
            this.isMetroOn = !this.isMetroOn;
            e.target.innerText = this.isMetroOn ? 'Stop' : 'Start';
            if(this.isMetroOn) this.playTick();
        };
        document.getElementById('reset-range').onclick = () => {
            this.minFreq = Infinity; this.maxFreq = -Infinity;
            document.getElementById('range-low').innerText = '--';
            document.getElementById('range-high').innerText = '--';
            this.pitchHistory = [];
        };
    },

    async startEngine() {
        try {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const source = this.audioCtx.createMediaStreamSource(stream);
            this.analyser = this.audioCtx.createAnalyser();
            // Critical: Larger FFT size for Bass/Low-end detail
            this.analyser.fftSize = 4096; 
            source.connect(this.analyser);
            document.getElementById('modal-permission').style.display = 'none';
            this.resizeCanvas();
            this.audioLoop();
        } catch (err) { alert("Mic access required."); }
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

    // Improved Autocorrelation for Low Frequencies
    detectPitch(data, sr) {
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / data.length);
        if (rms < this.threshold) return -1;

        // Downsampling check: For very low frequencies, we focus on the macro-pattern
        let c = new Float32Array(data.length).fill(0);
        for (let i = 0; i < data.length; i++) {
            for (let j = 0; j < data.length - i; j++) {
                c[i] += data[j] * data[j + i];
            }
        }

        let d = 0; while (c[d] > c[d + 1]) d++;
        let maxVal = -1, maxPos = -1;
        for (let i = d; i < data.length; i++) {
            if (c[i] > maxVal) {
                maxVal = c[i];
                maxPos = i;
            }
        }

        // Quadratic interpolation for sub-bin accuracy (Essential for Bass)
        let finalPos = maxPos;
        if (maxPos > 0 && maxPos < data.length - 1) {
            const a = c[maxPos - 1];
            const b = c[maxPos];
            const e = c[maxPos + 1];
            finalPos = maxPos + (e - a) / (2 * (2 * b - a - e));
        }

        return sr / finalPos;
    },

    // Median Filter: Ignores random jumps, keeps the "truth"
    getMedian(arr) {
        const sorted = [...arr].sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length / 2)];
    },

    drawHistogram() {
        const canvas = document.getElementById('history-canvas');
        if(!canvas) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        const range = 24; 
        const minY = this.currentCenterMidi - (range / 2);
        const maxY = this.currentCenterMidi + (range / 2);

        for (let m = Math.floor(minY); m <= Math.ceil(maxY); m++) {
            const y = h - ((m - minY) / range) * h;
            ctx.strokeStyle = (m % 12 === 0) ? '#334155' : '#1e293b'; 
            ctx.lineWidth = (m % 12 === 0) ? 2 : 1;
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
            ctx.fillStyle = (m % 12 === 0) ? '#94a3b8' : '#475569';
            ctx.font = '12px sans-serif';
            ctx.fillText(this.midiToNoteName(m), 10, y - 5);
        }

        if (this.pitchHistory.length < 2) return;

        ctx.lineWidth = 4;
        ctx.lineJoin = 'round';
        ctx.shadowBlur = 15;
        ctx.shadowColor = '#0ea5e9';
        ctx.beginPath();

        const step = w / this.maxHistory;
        this.pitchHistory.forEach((f, i) => {
            const midi = 12 * Math.log2(f / 440) + 69;
            const x = i * step;
            const y = h - ((midi - minY) / range) * h;
            ctx.strokeStyle = `hsl(${(midi * 10) % 360}, 80%, 60%)`;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.shadowBlur = 0;
    },

    midiToNoteName(midi) {
        const names = this.notes[this.notation];
        const noteName = names[((midi % 12) + 12) % 12];
        const octave = Math.floor(midi / 12) - 1;
        return noteName + octave;
    },

    audioLoop() {
        if (!this.isPaused) {
            this.analyser.getFloatTimeDomainData(this.buf);
            const raw = this.detectPitch(this.buf, this.audioCtx.sampleRate);

            if (raw !== -1 && raw < 2500) {
                this.smoothingWindow.push(raw);
                if (this.smoothingWindow.length > this.smoothingSize) this.smoothingWindow.shift();
                
                // Use Median instead of Mean for jitter rejection
                const freq = this.getMedian(this.smoothingWindow);

                const h = Math.round(12 * Math.log2(freq / this.refA4));
                const noteIdx = (h + 9) % 12;
                const noteName = this.notes[this.notation][noteIdx < 0 ? noteIdx + 12 : noteIdx];
                const oct = Math.floor((h + 9) / 12) + 4;
                const cents = Math.floor(1200 * Math.log2(freq / (this.refA4 * Math.pow(2, h/12))));

                document.getElementById('note-name').innerText = noteName;
                document.getElementById('note-octave').innerText = oct;
                document.getElementById('frequency').innerText = freq.toFixed(1);
                
                const needle = document.getElementById('tuner-needle');
                const percent = Math.max(-45, Math.min(45, (cents / 50) * 45)); 
                needle.style.transform = `translateX(${percent}vw)`;

                const targetMidi = 12 * Math.log2(freq / 440) + 69;
                this.currentCenterMidi += (targetMidi - this.currentCenterMidi) * 0.1;

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
                if (btn.dataset.view === 'analyze') setTimeout(() => this.resizeCanvas(), 50);
            };
        });
    }
};

App.init();
