const App = {
    audioCtx: null, analyser: null, buf: new Float32Array(2048),
    pitchHistory: [], maxHistory: 100, currentCenterMidi: 60,
    droneOscs: [], droneGain: null, droneActive: false, selectedDrone: "C",
    isMetroOn: false, metroTimeout: null, tempo: 120,
    refA4: 440, chromatic: ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'],

    init() { this.setupNav(); this.bindEvents(); },
    
    bindEvents() {
        document.getElementById('start-app-btn').onclick = () => this.start();
        document.getElementById('bpm-slider').oninput = (e) => { 
            this.tempo = e.target.value; 
            document.getElementById('bpm-value').innerText = this.tempo; 
        };
        document.getElementById('metro-toggle').onclick = () => this.toggleMetronome();
        
        // Drone Note Selection
        document.querySelectorAll('.drone-note').forEach(b => b.onclick = () => {
            document.querySelectorAll('.drone-note').forEach(x => x.classList.remove('selected'));
            b.classList.add('selected'); 
            this.selectedDrone = b.dataset.note;
            if(this.droneActive) this.updateDronePitch();
        });

        // Volume Control
        document.getElementById('drone-volume').oninput = (e) => {
            if(this.droneGain) {
                this.droneGain.gain.setTargetAtTime(parseFloat(e.target.value), this.audioCtx.currentTime, 0.1);
            }
        };

        document.getElementById('drone-toggle').onclick = () => this.toggleDrone();
        document.getElementById('setting-ref-pitch').onchange = (e) => { 
            this.refA4 = parseInt(e.target.value) || 440; 
        };
    },

    async start() {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } });
        this.analyser = this.audioCtx.createAnalyser();
        this.analyser.fftSize = 2048;
        this.audioCtx.createMediaStreamSource(stream).connect(this.analyser);
        document.getElementById('modal-permission').style.display = 'none';
        this.resizeCanvas();
        this.loop();
    },

    getPitch(data, sr) {
        let rms = 0; for(let i=0; i<data.length; i++) rms += data[i]*data[i];
        if(Math.sqrt(rms/data.length) < 0.01) return -1;
        let c = new Float32Array(data.length);
        for(let i=0; i<data.length; i++) { for(let j=0; j<data.length-i; j++) c[i] += data[j]*data[j+i]; }
        let d=0; while(c[d]>c[d+1]) d++;
        let maxV=-1, maxP=-1;
        for(let i=d; i<data.length; i++) { if(c[i]>maxV){maxV=c[i]; maxP=i;}}
        return sr/maxP;
    },

    drawHistogram() {
        const c = document.getElementById('history-canvas'); if(!c) return;
        const ctx = c.getContext('2d'); const w = c.width, h = c.height;
        ctx.fillStyle = '#000'; ctx.fillRect(0,0,w,h);
        const range = 24, minY = this.currentCenterMidi - 12;
        ctx.font = '12px monospace';
        for(let m = Math.floor(minY); m <= minY+range; m++) {
            const y = h - ((m-minY)/range) * h;
            ctx.strokeStyle = (m%12===0) ? '#333' : '#111';
            ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke();
            if(y > 0 && y < h) {
                ctx.fillStyle = (m%12===0) ? '#0ea5e9' : '#333';
                ctx.fillText(this.chromatic[((m%12)+12)%12] + (Math.floor(m/12)-1), 10, y-5);
            }
        }
        if(this.pitchHistory.length < 2) return;
        ctx.strokeStyle = '#0ea5e9'; ctx.lineWidth = 3; ctx.beginPath();
        let first = true;
        this.pitchHistory.forEach((f, i) => {
            if(!f) { first = true; return; }
            const m = 12 * Math.log2(f/this.refA4) + 69;
            const x = (i/this.maxHistory)*w;
            const y = h - ((m-minY)/range) * h;
            if(first) { ctx.moveTo(x,y); first = false; } else { ctx.lineTo(x,y); }
        });
        ctx.stroke();
    },

    loop() {
        if(this.analyser) {
            this.analyser.getFloatTimeDomainData(this.buf);
            const f = this.getPitch(this.buf, this.audioCtx.sampleRate);
            if(f > 20 && f < 2000) {
                const h = Math.round(12*Math.log2(f/this.refA4));
                const cents = Math.floor(1200 * Math.log2(f / (this.refA4 * Math.pow(2, h/12))));
                document.getElementById('note-name').innerText = this.chromatic[((h+9)%12+12)%12];
                document.getElementById('note-octave').innerText = Math.floor((h+9)/12)+4;
                document.getElementById('frequency').innerText = f.toFixed(1);
                document.getElementById('tuner-needle').style.transform = `translateX(${(cents/50)*40}vw)`; 
                this.currentCenterMidi += ( (12*Math.log2(f/this.refA4)+69) - this.currentCenterMidi) * 0.1;
                this.pitchHistory.push(f);
            } else { this.pitchHistory.push(null); }
            if(this.pitchHistory.length > this.maxHistory) this.pitchHistory.shift();
            if(document.getElementById('view-analyze').classList.contains('active')) this.drawHistogram();
        }
        requestAnimationFrame(() => this.loop());
    },

    toggleMetronome() {
        this.isMetroOn = !this.isMetroOn;
        document.getElementById('metro-toggle').innerText = this.isMetroOn ? 'Stop' : 'Start';
        if(this.isMetroOn) this.playTick(); else clearTimeout(this.metroTimeout);
    },

    playTick() {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.frequency.value = 1000;
        gain.gain.exponentialRampToValueAtTime(0.00001, this.audioCtx.currentTime + 0.1);
        osc.connect(gain); gain.connect(this.audioCtx.destination);
        osc.start(); osc.stop(this.audioCtx.currentTime + 0.1);
        this.metroTimeout = setTimeout(() => this.playTick(), (60/this.tempo)*1000);
    },

    toggleDrone() {
        this.droneActive = !this.droneActive;
        document.getElementById('drone-toggle').innerText = this.droneActive ? 'Stop Drone' : 'Play Drone';
        this.droneActive ? this.startDrone() : this.stopDrone();
    },

    startDrone() {
        this.droneGain = this.audioCtx.createGain();
        const vol = document.getElementById('drone-volume').value;
        this.droneGain.gain.value = parseFloat(vol);
        this.droneGain.connect(this.audioCtx.destination);
        this.updateDronePitch();
    },

    updateDronePitch() {
        this.stopOscs();
        const freqs = { 'C': 130.81, 'C#': 138.59, 'D': 146.83, 'D#': 155.56, 'E': 164.81, 'F': 174.61, 'F#': 185.00, 'G': 196.00, 'G#': 207.65, 'A': 220.00, 'A#': 233.08, 'B': 246.94 };
        const root = freqs[this.selectedDrone];
        
        // Complex Tone Synthesis: Sub-octave, Root, Fifth, and High Octave
        const harmonics = [0.5, 1, 1.5, 2]; 
        
        harmonics.forEach(m => {
            const osc = this.audioCtx.createOscillator();
            // Use Triangle waves for a warmer, more acoustic drone feel
            osc.type = 'triangle'; 
            osc.frequency.value = root * m;
            osc.connect(this.droneGain);
            osc.start();
            this.droneOscs.push(osc);
        });
    },

    stopOscs() { this.droneOscs.forEach(o => o.stop()); this.droneOscs = []; },
    stopDrone() { this.stopOscs(); if(this.droneGain) this.droneGain.disconnect(); },
    resizeCanvas() { const c = document.getElementById('history-canvas'); if(c) { c.width = c.clientWidth; c.height = c.clientHeight; } },
    
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
