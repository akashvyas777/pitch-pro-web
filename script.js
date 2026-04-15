const App = {
    audioCtx: null,
    analyser: null,
    microphone: null,
    isPaused: false,
    history: [],
    maxHistory: 100,

    // Range Test
    minFreq: Infinity,
    maxFreq: -Infinity,

    // Metronome
    isMetroRunning: false,
    tempo: 120,
    metroTimeout: null,

    // Settings
    refPitch: 440,
    threshold: 0.01,
    notation: 'english',
    notes: {
        english: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'],
        solfege: ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si']
    },

    init() {
        this.bindEvents();
        this.setupNavigation();
        this.setupCanvases();
    },

    setupCanvases() {
        this.hCanvas = document.getElementById('history-canvas');
        this.wCanvas = document.getElementById('waveform-canvas');
        this.hCtx = this.hCanvas.getContext('2d');
        this.wCtx = this.wCanvas.getContext('2d');
        
        // Match resolution to display size
        this.hCanvas.width = this.hCanvas.offsetWidth;
        this.hCanvas.height = this.hCanvas.offsetHeight;
        this.wCanvas.width = this.wCanvas.offsetWidth;
        this.wCanvas.height = this.wCanvas.offsetHeight;
    },

    async startAudio() {
        try {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.microphone = this.audioCtx.createMediaStreamSource(stream);
            this.analyser = this.audioCtx.createAnalyser();
            this.analyser.fftSize = 2048;
            this.microphone.connect(this.analyser);
            
            document.getElementById('modal-permission').style.display = 'none';
            document.getElementById('connection-status').innerText = 'System Live';
            this.update();
        } catch (e) { alert('Microphone access is required.'); }
    },

    bindEvents() {
        document.getElementById('start-app-btn').onclick = () => this.startAudio();
        
        document.getElementById('freeze-btn').onclick = () => {
            this.isPaused = !this.isPaused;
            document.querySelector('#freeze-btn i').setAttribute('data-lucide', this.isPaused ? 'play' : 'pause');
            lucide.createIcons();
        };

        const metroBtn = document.getElementById('metro-toggle');
        metroBtn.onclick = () => {
            this.isMetroRunning = !this.isMetroRunning;
            metroBtn.innerText = this.isMetroRunning ? 'Stop Metronome' : 'Start Metronome';
            if (this.isMetroRunning) this.playClick();
        };

        document.getElementById('bpm-slider').oninput = (e) => {
            this.tempo = e.target.value;
            document.getElementById('bpm-value').innerText = this.tempo;
        };

        document.getElementById('reset-range').onclick = () => {
            this.minFreq = Infinity; this.maxFreq = -Infinity;
            document.getElementById('range-low').innerText = '--';
            document.getElementById('range-high').innerText = '--';
        };

        document.getElementById('setting-notation').onchange = (e) => this.notation = e.target.value;
        document.getElementById('setting-threshold').oninput = (e) => this.threshold = parseFloat(e.target.value);
    },

    playClick() {
        if (!this.isMetroRunning) return;
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.frequency.setValueAtTime(1000, this.audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.1);
        osc.connect(gain); gain.connect(this.audioCtx.destination);
        osc.start(); osc.stop(this.audioCtx.currentTime + 0.1);
        this.metroTimeout = setTimeout(() => this.playClick(), (60 / this.tempo) * 1000);
    },

    autoCorrelate(buf, sampleRate) {
        let rms = 0;
        for (let i=0; i<buf.length; i++) rms += buf[i]*buf[i];
        if (Math.sqrt(rms/buf.length) < this.threshold) return -1;

        let r1=0, r2=buf.length-1, thres=0.2;
        for (let i=0; i<buf.length/2; i++) if (Math.abs(buf[i])<thres) { r1=i; break; }
        for (let i=1; i<buf.length/2; i++) if (Math.abs(buf[buf.length-i])<thres) { r2=buf.length-i; break; }
        buf = buf.slice(r1,r2);

        let c = new Array(buf.length).fill(0);
        for (let i=0; i<buf.length; i++)
            for (let j=0; j<buf.length-i; j++) c[i] = c[i] + buf[j]*buf[j+i];

        let d=0; while (c[d]>c[d+1]) d++;
        let maxval=-1, maxpos=-1;
        for (let i=d; i<buf.length; i++) if (c[i]>maxval) { maxval=c[i]; maxpos=i; }
        return sampleRate/maxpos;
    },

    drawWaveform(buf) {
        const ctx = this.wCtx;
        ctx.clearRect(0, 0, this.wCanvas.width, this.wCanvas.height);
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        const sliceWidth = this.wCanvas.width / buf.length;
        let x = 0;
        for (let i = 0; i < buf.length; i++) {
            const v = buf[i] * 0.5 + 0.5;
            const y = v * this.wCanvas.height;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            x += sliceWidth;
        }
        ctx.stroke();
    },

    drawHistory() {
        const ctx = this.hCtx;
        ctx.clearRect(0, 0, this.hCanvas.width, this.hCanvas.height);
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 3;
        ctx.beginPath();
        this.history.forEach((f, i) => {
            const x = (i / this.maxHistory) * this.hCanvas.width;
            const y = this.hCanvas.height - (Math.log10(f/20) / Math.log10(2000/20) * this.hCanvas.height);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
    },

    update() {
        if (!this.isPaused) {
            const buf = new Float32Array(2048);
            this.analyser.getFloatTimeDomainData(buf);
            this.drawWaveform(buf);

            const pitch = this.autoCorrelate(buf, this.audioCtx.sampleRate);
            if (pitch !== -1 && pitch < 3000) {
                const note = this.getNote(pitch);
                document.getElementById('note-name').innerText = note.name;
                document.getElementById('note-octave').innerText = note.octave;
                document.getElementById('frequency').innerText = pitch.toFixed(1);
                document.getElementById('tuner-needle').style.transform = `translateX(${note.cents * 2}px)`;

                this.history.push(pitch);
                if (this.history.length > this.maxHistory) this.history.shift();
                this.drawHistory();

                if (pitch < this.minFreq) { this.minFreq = pitch; document.getElementById('range-low').innerText = note.name + note.octave; }
                if (pitch > this.maxFreq) { this.maxFreq = pitch; document.getElementById('range-high').innerText = note.name + note.octave; }
            }
        }
        requestAnimationFrame(() => this.update());
    },

    getNote(freq) {
        const h = Math.round(12 * Math.log2(freq / this.refPitch));
        const oct = Math.floor((h + 9) / 12) + 4;
        const idx = (h + 9) % 12;
        const cents = Math.floor(1200 * Math.log2(freq / (this.refPitch * Math.pow(2, h/12))));
        return { name: this.notes[this.notation][idx < 0 ? idx + 12 : idx], octave: oct, cents: cents };
    },

    setupNavigation() {
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('.nav-item, .view').forEach(el => el.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(`view-${btn.dataset.view}`).classList.add('active');
            };
        });
    }
};

App.init();
