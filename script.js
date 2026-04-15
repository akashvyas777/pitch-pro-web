const App = {
    audioCtx: null, analyser: null,
    buf: new Float32Array(4096),
    isPaused: false,
    pitchHistory: [], maxHistory: 100, currentCenterMidi: 60,
    droneOscs: [], droneActive: false, selectedDrone: "C",
    tempo: 120, isMetroOn: false, metroTimeout: null,
    refA4: 440, chromatic: ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'],

    init() {
        this.setupNav();
        document.getElementById('start-app-btn').onclick = () => this.start();
        document.getElementById('freeze-btn').onclick = () => this.isPaused = !this.isPaused;
        this.bindPractice();
    },

    async start() {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false } 
        });
        const source = this.audioCtx.createMediaStreamSource(stream);
        this.analyser = this.audioCtx.createAnalyser();
        this.analyser.fftSize = 4096;
        source.connect(this.analyser);
        document.getElementById('modal-permission').style.display = 'none';
        this.resizeCanvas();
        this.loop();
    },

    getPitch(data, sr) {
        let rms = 0; for(let i=0; i<data.length; i++) rms += data[i]*data[i];
        if(Math.sqrt(rms/data.length) < 0.01) return -1;
        
        let r1 = 0, r2 = data.length - 1, thres = 0.2;
        for(let i=0; i<data.length/2; i++) if(Math.abs(data[i])<thres) { r1=i; break; }
        for(let i=1; i<data.length/2; i++) if(Math.abs(data[data.length-i])<thres) { r2=data.length-i; break; }
        let b = data.slice(r1, r2);
        
        let c = new Float32Array(b.length).fill(0);
        for(let i=0; i<b.length; i++) {
            for(let j=0; j<b.length-i; j++) c[i] += b[j]*b[j+i];
        }
        let d=0; while(c[d] > c[d+1]) d++;
        let maxV = -1, maxP = -1;
        for(let i=d; i<b.length; i++) { if(c[i] > maxV) { maxV = c[i]; maxP = i; } }
        return sr / maxP;
    },

    drawAnalyze() {
        const canvas = document.getElementById('history-canvas');
        if(!canvas || !document.getElementById('view-analyze').classList.contains('active')) return;
        const ctx = canvas.getContext('2d', {alpha: false});
        const w = canvas.width, h = canvas.height;
        ctx.fillStyle = '#000'; ctx.fillRect(0,0,w,h);
        
        const range = 24; 
        const minY = this.currentCenterMidi - 12;

        ctx.font = '12px monospace';
        for(let m = Math.floor(minY); m <= minY + range; m++) {
            const y = h - ((m - minY) / range) * h;
            ctx.strokeStyle = (m % 12 === 0) ? '#444' : '#1e293b';
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
            ctx.fillStyle = (m % 12 === 0) ? '#38bdf8' : '#444';
            ctx.fillText(`${this.chromatic[((m%12)+12)%12]}${Math.floor(m/12)-1}`, 10, y - 5);
        }

        if(this.pitchHistory.length < 2) return;
        ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 3; ctx.beginPath();
        let first = true;
        this.pitchHistory.forEach((f, i) => {
            if(!f) { first = true; return; }
            const m = 12 * Math.log2(f/440) + 69;
            const x = (i / this.maxHistory) * w;
            const y = h - ((m - minY) / range) * h;
            if(first) { ctx.moveTo(x, y); first = false; } else { ctx.lineTo(x, y); }
        });
        ctx.stroke();
    },

    loop() {
        if(!this.isPaused && this.analyser) {
            this.analyser.getFloatTimeDomainData(this.buf);
            const f = this.getPitch(this.buf, this.audioCtx.sampleRate);
            if(f > 20 && f < 1500) {
                const h = Math.round(12 * Math.log2(f/440));
                const cents = Math.floor(1200 * Math.log2(f / (440 * Math.pow(2, h/12))));
                document.getElementById('note-name').innerText = this.chromatic[((h+9)%12+12)%12];
                document.getElementById('frequency').innerText = f.toFixed(1) + " Hz";
                document.getElementById('tuner-needle').style.transform = `translateX(${(cents/50) * 45}vw)`;
                this.currentCenterMidi += ( (12 * Math.log2(f/440) + 69) - this.currentCenterMidi) * 0.1;
                this.pitchHistory.push(f);
            } else { this.pitchHistory.push(null); }
            if(this.pitchHistory.length > this.maxHistory) this.pitchHistory.shift();
            this.drawAnalyze();
        }
        requestAnimationFrame(() => this.loop());
    },

    bindPractice() {
        document.getElementById('bpm-slider').oninput = (e) => {
            this.tempo = e.target.value;
            document.getElementById('bpm-value').innerText = this.tempo;
        };
        document.getElementById('metro-toggle').onclick = () => this.toggleMetro();
        document.querySelectorAll('.drone-note').forEach(b => b.onclick = () => {
            document.querySelectorAll('.drone-note').forEach(x => x.classList.remove('selected'));
            b.classList.add('selected'); this.selectedDrone = b.dataset.note;
            if(this.droneActive) this.startDrone();
        });
        document.getElementById('drone-toggle').onclick = () => {
            this.droneActive = !this.droneActive;
            document.getElementById('drone-toggle').innerText = this.droneActive ? 'Stop' : 'Play Drone';
            this.droneActive ? this.startDrone() : this.stopDrone();
        };
    },

    startDrone() {
        this.stopDrone();
        const root = {"C":130.8,"C#":138.6,"D":146.8,"G":196.0}[this.selectedDrone] || 130.8;
        this.droneGain = this.audioCtx.createGain();
        [1, 1.5, 2].forEach(m => {
            const o = this.audioCtx.createOscillator();
            o.frequency.value = root * m; o.connect(this.droneGain); o.start();
            this.droneOscs.push(o);
        });
        this.droneGain.gain.value = 0.3; this.droneGain.connect(this.audioCtx.destination);
    },

    stopDrone() { if(this.droneGain) this.droneGain.disconnect(); this.droneOscs.forEach(o => o.stop()); this.droneOscs = []; },

    toggleMetro() {
        this.isMetroOn = !this.isMetroOn;
        document.getElementById('metro-toggle').innerText = this.isMetroOn ? 'Stop' : 'Start';
        if(this.isMetroOn) this.playTick(); else clearTimeout(this.metroTimeout);
    },

    playTick() {
        const o = this.audioCtx.createOscillator(); const g = this.audioCtx.createGain();
        o.frequency.value = 1000; g.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.1);
        o.connect(g); g.connect(this.audioCtx.destination); o.start(); o.stop(this.audioCtx.currentTime + 0.1);
        this.metroTimeout = setTimeout(() => this.playTick(), (60/this.tempo)*1000);
    },

    resizeCanvas() {
        const c = document.getElementById('history-canvas');
        if(c) { c.width = window.innerWidth; c.height = window.innerHeight - 85; }
    },

    setupNav() {
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('.nav-item, .view').forEach(el => el.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(`view-${btn.dataset.view}`).classList.add('active');
                if(btn.dataset.view === 'analyze') this.resizeCanvas();
            };
        });
    }
};
App.init();
