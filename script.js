const App = {
    audioCtx: null, analyser: null, buf: new Float32Array(2048), isPaused: false,
    pitchHistory: [], maxHistory: 100, currentCenterMidi: 60,
    droneOscs: [], droneGain: null, droneActive: false, selectedDrone: "C",
    isMetroOn: false, metroTimeout: null, tempo: 120,
    refA4: 440, chromatic: ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'],

    init() { this.setupNav(); this.bindEvents(); },
    bindEvents() {
        document.getElementById('start-app-btn').onclick = () => this.start();
        document.getElementById('freeze-btn').onclick = () => { this.isPaused = !this.isPaused; };
        document.getElementById('bpm-slider').oninput = (e) => { this.tempo = e.target.value; document.getElementById('bpm-value').innerText = this.tempo; };
        document.getElementById('metro-toggle').onclick = () => this.toggleMetronome();
        document.querySelectorAll('.drone-note').forEach(b => b.onclick = () => {
            document.querySelectorAll('.drone-note').forEach(x => x.classList.remove('selected'));
            b.classList.add('selected'); this.selectedDrone = b.dataset.note;
            if(this.droneActive) this.updateDronePitch();
        });
        document.getElementById('drone-toggle').onclick = () => {
            this.droneActive = !this.droneActive;
            document.getElementById('drone-toggle').innerText = this.droneActive ? 'Stop Drone' : 'Play Drone';
            this.droneActive ? this.startDrone() : this.stopDrone();
        };
        document.getElementById('drone-volume').oninput = (e) => {
            if(this.droneGain) this.droneGain.gain.setTargetAtTime(e.target.value, this.audioCtx.currentTime, 0.05);
        };
    },
    async start() {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const source = this.audioCtx.createMediaStreamSource(stream);
        this.analyser = this.audioCtx.createAnalyser();
        this.analyser.fftSize = 2048; source.connect(this.analyser);
        document.getElementById('modal-permission').style.display = 'none';
        this.resizeCanvas(); this.loop();
    },
    toggleMetronome() {
        this.isMetroOn = !this.isMetroOn;
        document.getElementById('metro-toggle').innerText = this.isMetroOn ? 'Stop' : 'Start';
        if (this.isMetroOn) this.playTick();
        else clearTimeout(this.metroTimeout);
    },
    playTick() {
        if (!this.isMetroOn) return;
        const osc = this.audioCtx.createOscillator(); const gain = this.audioCtx.createGain();
        osc.frequency.value = 1000; gain.gain.setValueAtTime(0.1, this.audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.05);
        osc.connect(gain); gain.connect(this.audioCtx.destination);
        osc.start(); osc.stop(this.audioCtx.currentTime + 0.05);
        this.metroTimeout = setTimeout(() => this.playTick(), (60 / this.tempo) * 1000);
    },
    // DRONE: Continuous Play Fix
    startDrone() {
        if(this.droneOscs.length > 0) this.stopDrone();
        this.droneGain = this.audioCtx.createGain();
        const root = this.getFreq(this.selectedDrone);
        [0.5, 1, 1.5, 2].forEach((m, i) => {
            const o = this.audioCtx.createOscillator();
            o.type = i === 0 ? 'sine' : 'sawtooth';
            o.frequency.setValueAtTime(root * m, this.audioCtx.currentTime);
            const g = this.audioCtx.createGain();
            g.gain.value = [0.4, 0.2, 0.1, 0.05][i];
            o.connect(g); g.connect(this.droneGain);
            o.start(); this.droneOscs.push(o);
        });
        const vol = document.getElementById('drone-volume').value;
        this.droneGain.gain.setValueAtTime(vol, this.audioCtx.currentTime);
        this.droneGain.connect(this.audioCtx.destination);
    },
    updateDronePitch() {
        const root = this.getFreq(this.selectedDrone);
        this.droneOscs.forEach((o, i) => {
            o.frequency.setTargetAtTime(root * [0.5, 1, 1.5, 2][i], this.audioCtx.currentTime, 0.1);
        });
    },
    stopDrone() {
        if (this.droneGain) this.droneGain.gain.setTargetAtTime(0, this.audioCtx.currentTime, 0.1);
        setTimeout(() => { 
            this.droneOscs.forEach(o => { try{o.stop();}catch(e){} }); 
            this.droneOscs = []; 
        }, 150);
    },
    getFreq(n) { return {"C":130.8,"C#":138.6,"D":146.8,"D#":155.6,"E":164.8,"F":174.6,"F#":185,"G":196,"G#":207.7,"A":220,"A#":233.1,"B":246.9}[n]; },
    detectPitch(data, sr) {
        let sum = 0; for(let i=0; i<data.length; i++) sum += data[i]*data[i];
        if(Math.sqrt(sum/data.length) < 0.02) return -1;
        let c = new Float32Array(data.length);
        for(let i=0; i<data.length; i++) { for(let j=0; j<data.length-i; j++) c[i] += data[j]*data[j+i]; }
        let d=0; while(c[d]>c[d+1]) d++;
        let maxV = -1, maxP = -1;
        for(let i=d; i<data.length; i++) { if(c[i]>maxV) { maxV=c[i]; maxP=i; } }
        return sr/maxP;
    },
    // UNTOUCHED Spectrogram logic
    drawHistogram() {
        const c = document.getElementById('history-canvas'); if(!c) return;
        const ctx = c.getContext('2d'); const w = c.width, h = c.height;
        ctx.clearRect(0,0,w,h);
        const range = 24; const minY = this.currentCenterMidi - 12;
        for(let m=Math.floor(minY); m<=minY+range; m++) {
            const y = h - ((m-minY)/range)*h;
            ctx.strokeStyle = (m%12===0) ? '#444' : '#1e293b';
            ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke();
            ctx.fillStyle = '#64748b'; ctx.font = '12px sans-serif';
            ctx.fillText(this.chromatic[((m%12)+12)%12] + (Math.floor(m/12)-1), 10, y-5);
        }
        if(this.pitchHistory.length < 2) return;
        ctx.strokeStyle = '#0ea5e9'; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.beginPath();
        this.pitchHistory.forEach((f,i) => {
            if(!f) return;
            const m = 12 * Math.log2(f/440) + 69;
            const x = (i/this.maxHistory)*w, y = h - ((m-minY)/range)*h;
            if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
        });
        ctx.stroke();
    },
    loop() {
        if(!this.isPaused && this.analyser) {
            this.analyser.getFloatTimeDomainData(this.buf);
            const f = this.detectPitch(this.buf, this.audioCtx.sampleRate);
            if(f > 0 && f < 2000) {
                const h = Math.round(12 * Math.log2(f/this.refA4));
                const cents = Math.floor(1200 * Math.log2(f / (this.refA4 * Math.pow(2, h/12))));
                document.getElementById('note-name').innerText = this.chromatic[((h+9)%12+12)%12];
                document.getElementById('note-octave').innerText = Math.floor((h+9)/12)+4;
                document.getElementById('frequency').innerText = f.toFixed(1);
                const needle = document.getElementById('tuner-needle');
                // Center the needle movement (cents is -50 to +50)
                needle.style.transform = `translateX(${(cents/50)*40}vw)`; 
                this.currentCenterMidi += ( (12*Math.log2(f/440)+69) - this.currentCenterMidi) * 0.1;
                this.pitchHistory.push(f);
            } else { this.pitchHistory.push(null); }
            if(this.pitchHistory.length > this.maxHistory) this.pitchHistory.shift();
            if(document.getElementById('view-analyze').classList.contains('active')) this.drawHistogram();
        }
        requestAnimationFrame(() => this.loop());
    },
    resizeCanvas() { const c = document.getElementById('history-canvas'); if(c) { c.width = c.clientWidth; c.height = c.clientHeight; } },
    setupNav() {
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('.nav-item, .view').forEach(el => el.classList.remove('active'));
                btn.classList.add('active'); document.getElementById(`view-${btn.dataset.view}`).classList.add('active');
                if(btn.dataset.view === 'analyze') setTimeout(() => this.resizeCanvas(), 50);
            };
        });
    }
};
App.init();
