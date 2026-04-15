const App = {
    audioCtx: null, analyser: null,
    buf: new Float32Array(4096), 
    isPaused: false,
    pitchHistory: [], maxHistory: 150,
    smoothingWindow: [], smoothingSize: 10,
    currentCenterMidi: 60,
    droneOscs: [], droneGain: null, droneActive: false,
    selectedDrone: "C", isMetroOn: false, tempo: 120,
    refA4: 440, threshold: 0.015,
    chromatic: ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'],

    init() {
        this.setupNav();
        this.bindEvents();
        window.addEventListener('resize', () => this.resizeCanvas());
    },

    bindEvents() {
        document.getElementById('start-app-btn').onclick = () => this.start();
        document.getElementById('freeze-btn').onclick = () => {
            this.isPaused = !this.isPaused;
            document.querySelector('#freeze-btn i').setAttribute('data-lucide', this.isPaused ? 'play' : 'pause');
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
        document.querySelectorAll('.drone-note').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('.drone-note').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                this.selectedDrone = btn.dataset.note;
                if(this.droneActive) this.updateDrone();
            };
        });
        document.getElementById('drone-toggle').onclick = () => {
            this.droneActive = !this.droneActive;
            document.getElementById('drone-toggle').innerText = this.droneActive ? 'Stop Drone' : 'Play Drone';
            this.droneActive ? this.startDrone() : this.stopDrone();
        };
        document.getElementById('setting-ref-pitch').onchange = (e) => this.refA4 = parseFloat(e.target.value);
    },

    async start() {
        try {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const source = this.audioCtx.createMediaStreamSource(stream);
            this.analyser = this.audioCtx.createAnalyser();
            this.analyser.fftSize = 4096;
            source.connect(this.analyser);
            document.getElementById('modal-permission').style.display = 'none';
            this.resizeCanvas();
            this.loop();
        } catch (e) { alert("Mic access denied."); }
    },

    playTick() {
        if(!this.isMetroOn) return;
        const o = this.audioCtx.createOscillator();
        const g = this.audioCtx.createGain();
        o.frequency.value = 1000;
        g.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.1);
        o.connect(g); g.connect(this.audioCtx.destination);
        o.start(); o.stop(this.audioCtx.currentTime + 0.1);
        setTimeout(() => this.playTick(), (60/this.tempo)*1000);
    },

    startDrone() {
        this.droneOscs = [];
        this.droneGain = this.audioCtx.createGain();
        const filter = this.audioCtx.createBiquadFilter();
        filter.type = "lowpass"; filter.frequency.value = 450;
        const root = this.getFreq(this.selectedDrone);
        const harmonics = [0.5, 1, 1.5, 2]; 
        harmonics.forEach((ratio, i) => {
            const osc = this.audioCtx.createOscillator();
            osc.type = "sawtooth";
            osc.frequency.value = root * ratio;
            const oscGain = this.audioCtx.createGain();
            oscGain.gain.value = (i === 1) ? 0.7 : (i === 0) ? 0.6 : (i === 2) ? 0.3 : 0.15;
            osc.connect(oscGain); oscGain.connect(filter);
            this.droneOscs.push(osc);
        });
        const vol = document.getElementById('drone-volume').value;
        this.droneGain.gain.setValueAtTime(0, this.audioCtx.currentTime);
        this.droneGain.gain.linearRampToValueAtTime(vol, this.audioCtx.currentTime + 1.2);
        filter.connect(this.droneGain); this.droneGain.connect(this.audioCtx.destination);
        this.droneOscs.forEach(o => o.start());
    },

    stopDrone() {
        if(this.droneGain) {
            this.droneGain.gain.linearRampToValueAtTime(0, this.audioCtx.currentTime + 0.8);
            setTimeout(() => { if(this.droneOscs) this.droneOscs.forEach(o => { try{o.stop();}catch(e){} }); this.droneOscs = []; }, 800);
        }
    },

    updateDrone() {
        if(this.droneOscs.length > 0) {
            const root = this.getFreq(this.selectedDrone);
            const ratios = [0.5, 1, 1.5, 2];
            this.droneOscs.forEach((o, i) => o.frequency.setTargetAtTime(root * ratios[i], this.audioCtx.currentTime, 0.2));
        }
    },

    getFreq(note) {
        const f = {"C":130.81,"C#":138.59,"D":146.83,"D#":155.56,"E":164.81,"F":174.61,"F#":185.00,"G":196.00,"G#":207.65,"A":220.00,"A#":233.08,"B":246.94};
        return f[note];
    },

    detectPitch(data, sr) {
        let sum = 0; for (let i=0; i<data.length; i++) sum += data[i]*data[i];
        if (Math.sqrt(sum/data.length) < this.threshold) return -1;
        let c = new Float32Array(data.length).fill(0);
        for (let i=0; i<data.length; i++) {
            for (let j=0; j<data.length-i; j++) c[i] += data[j]*data[j+i];
        }
        let d=0; while (c[d]>c[d+1]) d++;
        let maxVal = -1, maxPos = -1;
        for (let i=d; i<data.length; i++) { if (c[i]>maxVal) { maxVal=c[i]; maxPos=i; } }
        let finalPos = maxPos;
        if (maxPos > 0 && maxPos < data.length - 1) {
            const a = c[maxPos - 1], b = c[maxPos], e = c[maxPos + 1];
            finalPos = maxPos + (e - a) / (2 * (2 * b - a - e));
        }
        return sr/finalPos;
    },

    getMedian(arr) {
        const s = [...arr].sort((a,b) => a-b);
        return s[Math.floor(s.length/2)];
    },

    drawHistogram() {
        const canvas = document.getElementById('history-canvas');
        if(!canvas) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;
        ctx.clearRect(0,0,w,h);
        const range = 24; 
        const minY = this.currentCenterMidi - 12, maxY = this.currentCenterMidi + 12;

        for (let m = Math.floor(minY); m <= Math.ceil(maxY); m++) {
            const y = h - ((m-minY)/range)*h;
            ctx.strokeStyle = (m%12===0) ? '#334155' : '#1e293b';
            ctx.lineWidth = (m%12===0) ? 2 : 1;
            ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke();
            ctx.fillStyle = (m%12===0) ? '#94a3b8' : '#475569';
            ctx.font = '11px monospace';
            ctx.fillText(this.chromatic[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1), 10, y - 5);
        }

        if (this.pitchHistory.length < 2) return;
        ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.shadowBlur = 12; ctx.shadowColor = '#0ea5e9';
        ctx.beginPath();
        const step = w / this.maxHistory;
        this.pitchHistory.forEach((f, i) => {
            const m = 12 * Math.log2(f/440) + 69;
            const x = i * step, y = h - ((m-minY)/range)*h;
            ctx.strokeStyle = `hsl(${(m*20)%360}, 80%, 60%)`;
            if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
        });
        ctx.stroke(); ctx.shadowBlur=0;
    },

    loop() {
        if(!this.isPaused) {
            this.analyser.getFloatTimeDomainData(this.buf);
            const raw = this.detectPitch(this.buf, this.audioCtx.sampleRate);
            if(raw !== -1 && raw < 2500) {
                this.smoothingWindow.push(raw);
                if(this.smoothingWindow.length > this.smoothingSize) this.smoothingWindow.shift();
                const freq = this.getMedian(this.smoothingWindow);
                const h = Math.round(12 * Math.log2(freq/this.refA4));
                const cents = Math.floor(1200 * Math.log2(freq/(this.refA4 * Math.pow(2, h/12))));
                document.getElementById('note-name').innerText = this.chromatic[((h+9)%12 + 12) % 12];
                document.getElementById('note-octave').innerText = Math.floor((h+9)/12)+4;
                document.getElementById('frequency').innerText = freq.toFixed(1);
                const needle = document.getElementById('tuner-needle');
                needle.style.transform = `translateX(${(cents/50)*45}vw)`;
                const targetMidi = 12 * Math.log2(freq/440) + 69;
                this.currentCenterMidi += (targetMidi - this.currentCenterMidi) * 0.1;
                this.pitchHistory.push(freq);
                if(this.pitchHistory.length > this.maxHistory) this.pitchHistory.shift();
                this.drawHistogram();
            }
        }
        requestAnimationFrame(() => this.loop());
    },

    resizeCanvas() {
        const c = document.getElementById('history-canvas');
        if(c) { c.width = c.clientWidth; c.height = c.clientHeight; }
    },

    setupNav() {
        document.querySelectorAll('.nav-item').forEach(b => {
            b.onclick = () => {
                document.querySelectorAll('.nav-item, .view').forEach(e => e.classList.remove('active'));
                b.classList.add('active');
                document.getElementById(`view-${b.dataset.view}`).classList.add('active');
                if(b.dataset.view==='analyze') setTimeout(()=>this.resizeCanvas(), 50);
            };
        });
    }
};
App.init();
