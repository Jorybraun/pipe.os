// ASCII Butterfly Animation - Inspired by Cognition Frontier Code
// Creates a digital butterfly made of binary/ASCII characters with ripple effects

class ButterflyAnimation {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.particles = [];
        this.ripples = [];
        this.resize();
        
        window.addEventListener('resize', () => this.resize());
        this.init();
        this.animate();
    }
    
    resize() {
        this.canvas.width = this.canvas.offsetWidth;
        this.canvas.height = this.canvas.offsetHeight;
        this.centerX = this.canvas.width / 2;
        this.centerY = this.canvas.height / 2;
    }
    
    init() {
        // Create butterfly particles
        this.createButterfly();
        
        // Create initial ripples
        for (let i = 0; i < 3; i++) {
            setTimeout(() => {
                this.createRipple();
            }, i * 1000);
        }
    }
    
    createButterfly() {
        const asciiChars = ['0', '1', '█', '▓', '▒', '░', '·', '*'];
        const colors = ['#0066ff', '#00ffff', '#00ff99', '#ffffff'];
        
        // Butterfly wing shape (simplified)
        const wingPoints = [
            // Left wing
            {x: -80, y: -60}, {x: -120, y: -40}, {x: -140, y: 0},
            {x: -120, y: 40}, {x: -80, y: 60}, {x: -40, y: 40},
            {x: -20, y: 20},
            // Right wing
            {x: 80, y: -60}, {x: 120, y: -40}, {x: 140, y: 0},
            {x: 120, y: 40}, {x: 80, y: 60}, {x: 40, y: 40},
            {x: 20, y: 20}
        ];
        
        // Create particles along wing outline
        wingPoints.forEach((point, index) => {
            for (let i = 0; i < 8; i++) {
                this.particles.push({
                    x: this.centerX + point.x + (Math.random() - 0.5) * 20,
                    y: this.centerY + point.y + (Math.random() - 0.5) * 20,
                    char: asciiChars[Math.floor(Math.random() * asciiChars.length)],
                    color: colors[Math.floor(Math.random() * colors.length)],
                    size: Math.random() * 2 + 1,
                    speedX: (Math.random() - 0.5) * 0.5,
                    speedY: (Math.random() - 0.5) * 0.5,
                    opacity: Math.random() * 0.5 + 0.5,
                    pulse: Math.random() * Math.PI * 2
                });
            }
        });
        
        // Add body particles
        for (let i = 0; i < 20; i++) {
            this.particles.push({
                x: this.centerX + (Math.random() - 0.5) * 10,
                y: this.centerY + (Math.random() - 0.5) * 60,
                char: '█',
                color: '#00ffff',
                size: Math.random() * 1.5 + 0.5,
                speedX: (Math.random() - 0.5) * 0.2,
                speedY: (Math.random() - 0.5) * 0.2,
                opacity: Math.random() * 0.7 + 0.3,
                pulse: Math.random() * Math.PI * 2
            });
        }
    }
    
    createRipple() {
        this.ripples.push({
            x: this.centerX,
            y: this.centerY,
            radius: 0,
            maxRadius: Math.max(this.canvas.width, this.canvas.height) * 0.6,
            opacity: 0.3,
            speed: 1.5,
            particles: []
        });
        
        // Add particles to ripple
        const ripple = this.ripples[this.ripples.length - 1];
        for (let i = 0; i < 30; i++) {
            const angle = (Math.PI * 2 * i) / 30;
            ripple.particles.push({
                angle: angle,
                distance: 0,
                char: ['0', '1', '·'][Math.floor(Math.random() * 3)],
                color: ['#0066ff', '#00ffff', '#00ff99'][Math.floor(Math.random() * 3)]
            });
        }
    }
    
    update() {
        // Update butterfly particles
        this.particles.forEach(p => {
            p.x += p.speedX;
            p.y += p.speedY;
            p.pulse += 0.05;
            
            // Gentle floating motion
            p.x += Math.sin(p.pulse) * 0.3;
            p.y += Math.cos(p.pulse) * 0.3;
            
            // Wrap around edges
            if (p.x < 0) p.x = this.canvas.width;
            if (p.x > this.canvas.width) p.x = 0;
            if (p.y < 0) p.y = this.canvas.height;
            if (p.y > this.canvas.height) p.y = 0;
        });
        
        // Update ripples
        this.ripples.forEach((ripple, index) => {
            ripple.radius += ripple.speed;
            ripple.opacity -= 0.002;
            
            ripple.particles.forEach(p => {
                p.distance = ripple.radius;
            });
            
            // Remove faded ripples
            if (ripple.opacity <= 0) {
                this.ripples.splice(index, 1);
                // Create new ripple periodically
                if (Math.random() < 0.01) {
                    this.createRipple();
                }
            }
        });
        
        // Occasionally create new ripples
        if (Math.random() < 0.005 && this.ripples.length < 3) {
            this.createRipple();
        }
    }
    
    draw() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Draw ripples
        this.ripples.forEach(ripple => {
            // Draw ripple ring
            this.ctx.beginPath();
            this.ctx.arc(ripple.x, ripple.y, ripple.radius, 0, Math.PI * 2);
            this.ctx.strokeStyle = `rgba(0, 255, 153, ${ripple.opacity * 0.3})`;
            this.ctx.lineWidth = 1;
            this.ctx.stroke();
            
            // Draw ripple particles
            ripple.particles.forEach(p => {
                const x = ripple.x + Math.cos(p.angle) * p.distance;
                const y = ripple.y + Math.sin(p.angle) * p.distance;
                
                this.ctx.fillStyle = p.color;
                this.ctx.globalAlpha = ripple.opacity;
                this.ctx.font = '12px Courier New';
                this.ctx.fillText(p.char, x, y);
            });
        });
        
        // Draw butterfly particles
        this.particles.forEach(p => {
            this.ctx.fillStyle = p.color;
            this.ctx.globalAlpha = p.opacity * (0.5 + Math.sin(p.pulse) * 0.3);
            this.ctx.font = `${p.size * 10}px Courier New`;
            this.ctx.fillText(p.char, p.x, p.y);
        });
        
        this.ctx.globalAlpha = 1;
    }
    
    animate() {
        this.update();
        this.draw();
        requestAnimationFrame(() => this.animate());
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('butterflyCanvas');
    if (canvas) {
        new ButterflyAnimation(canvas);
    }
});
