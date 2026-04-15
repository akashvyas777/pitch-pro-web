const App = {
    audioCtx: null,
    analyser: null,
    buf: new Float32Array(2048),
    isPaused: false,
    pitchHistory: [], // Stores last 200 pitch readings
    maxHistory: 200,

    // Range data
    minF: Infinity, maxF: -Infinity,

    // Metronome
    metroActive: false, tempo: 120, metroTimer: null,

    // Config
    ref: 440, thresh: 0.01, notation: 'english',
    notes: {
        english: ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'],
        solfege: ['Do','Do#','Re','Re#','Mi','Fa','Fa#','Sol','Sol#','La','La#','Si']
    },

    init() {
        this.setupNav();
        this.bindUI();
        window.addEventListener('resize', () => this.resizeCanvas());
    },

    bindUI() {
        document.getElementById('start-app-btn').onclick = () => this.start();
        document.getElementById('freeze-btn').onclick = (e) => {
            this.isPaused = !this.isPaused;
            const icon = document.querySelector('#freeze-btn i');
            icon.setAttribute('data-lucide', this.isPaused ? 'play' : 'pause');
            lucide.createIcons();
        };

        // Metronome
        document.getElementById('bpm-slider').oninput = (e) => {
            this.tempo = e.target.value;
            document.getElementById('bpm-value').innerText = this.tempo;
        };
        document.getElementById('metro-toggle').onclick = (e) => {
            this.metroActive = !this.metroActive;
            e.target.innerText = this.metroActive ? 'Stop' : 'Start';
            if(this.metroActive) this.runMetro();
        };

        // Range
        document.getElementById('reset-range').onclick = () => {
            this.minF = Infinity; this.maxF = -Infinity;
            document.getElementById('range-low').innerText = '--';
            document.getElementById('range-high').innerText = '--';
        };
    },

    async start() {
        try {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const source = this.audioCtx.createMediaStreamSource(stream);
            this.analyser = this.audioCtx.createAnalyser();
            this.analyser.fftSize = 2048;
            source.connect(this.analyser);
            
            document.getElementById('modal-permission').style.display = 'none';
            this.resizeCanvas();
            this.loop();
        } catch (e) { alert("Mic access required for tuner."); }
    },

    runMetro() {
        if(!this.metroActive) return;
        const osc = this.audioCtx.createOscillator();
        const g = this.audioCtx.createGain();
        osc.frequency.value = 1200;
        g.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.1);
        osc.connect(g); g.connect(this.audioCtx.destination);
        osc.start(); osc.stop(this.audioCtx.currentTime + 0.1);
        setTimeout(() => this.runMetro(), (60/this.tempo)*1000);
    },

    // YIN-lite / Autocorrelation
    getPitch(data, sr) {
        let sum = 0;
        for (let i=0; i<data.length; i++) sum += data[i]*data[i];
        if (Math.sqrt(sum/data.length) < this.thresh) return -1;

        let c = new Float32Array(data.length).fill(0);
        for (let i=0; i<data.length; i++) {
            for (let j=0; j<data.length-i; j++) c[i] += data[j]*data[j+i];
        }
        let d=0; while (c[d]>c[d+1]) d++;
        let maxVal = -1, maxPos = -1;
        for (let i=d; i<data.length; i++) {
            if (c[i] > maxVal) { maxVal = c[i]; maxPos = i; }
        }
        return sr/maxPos;
    },

    drawHistogram() {
        const canvas = document.getElementById('history-canvas');
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0,0, canvas.width, canvas.height);
        
        ctx.strokeStyle = '#0ea5e9';
        ctx.lineWidth = 2;
        ctx.beginPath();
        
        const step = canvas.width / this.maxHistory;
        for(let i=0; i<this.pitchHistory.length; i++) {
            const p = this.pitchHistory[i];
            const x = i * step;
            // Map freq to Y (log scale from 50Hz to 1500Hz)
            const y = canvas.height - (Math.log2(p/50) * (canvas.height/5));
            if(i===0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
    },

    loop() {
        if(!this.isPaused) {
            this.analyser.getFloatTimeDomainData(this.buf);
            const freq = this.getPitch(this.buf, this.audioCtx.sampleRate);

            if(freq !== -1 && freq < 2000) {
                const h = Math.round(12 * Math.log2(freq / this.ref));
                const noteIdx = (h + 9) % 12;
                const noteName = this.notes[this.notation][noteIdx < 0 ? noteIdx + 12 : noteIdx];
                const oct = Math.floor((h + 9) / 12) + 4;
                const cents = Math.floor(1200 * Math.log2(freq / (this.ref * Math.pow(2, h/12))));

                // Update UI
                document.getElementById('note-name').innerText = noteName;
                document.getElementById('note-octave').innerText = oct;
                document.getElementById('frequency').innerText = freq.toFixed(1);
                
                // Needle: -50 cents to +50 cents mapped to -45% to +45% container width
                const needle = document.getElementById('tuner-needle');
                const percent = (cents / 50) * 45; 
                needle.style.transform = `translateX(${percent}vw)`;

                // History
                this.pitchHistory.push(freq);
                if(this.pitchHistory.length > this.maxHistory) this.pitchHistory.shift();
                this.drawHistogram();

                // Range
                if(freq < this.minF) { this.minF = freq; document.getElementById('range-low').innerText = noteName+oct; }
                if(freq > this.maxF) { this.maxF = freq; document.getElementById('range-high').innerText = noteName+oct; }
            }
        }
        requestAnimationFrame(() => this.loop());
    },

    resizeCanvas() {
        const c = document.getElementById('history-canvas');
        c.width = c.clientWidth;
        c.height = c.clientHeight;
    },

    setupNav() {
        document.querySelectorAll('.nav-item').forEach(n => {
            n.onclick = () => {
                document.querySelectorAll('.nav-item, .view').forEach(x => x.classList.remove('active'));
                n.classList.add('active');
                document.getElementById(`view-${n.dataset.view}`).classList.add('active');
                if(n.dataset.view === 'analyze') this.resizeCanvas();
            };
        });
    }
};

App.init();
