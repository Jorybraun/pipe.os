// AGENTS OF CHAOS - Slide Navigation and Interactions

class SlideDeck {
    constructor() {
        this.currentSlide = 0;
        this.slides = [];
        this.loadSlides();
        this.setupNavigation();
    }
    
    loadSlides() {
        // This will be populated from slides.json
        // For now, we have the first slide hardcoded in HTML
        console.log('Slide deck initialized');
    }
    
    setupNavigation() {
        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowRight' || e.key === ' ') {
                this.nextSlide();
            } else if (e.key === 'ArrowLeft') {
                this.prevSlide();
            }
        });
        
        // Touch navigation for mobile
        let touchStartX = 0;
        document.addEventListener('touchstart', (e) => {
            touchStartX = e.touches[0].clientX;
        });
        
        document.addEventListener('touchend', (e) => {
            const touchEndX = e.changedTouches[0].clientX;
            const diff = touchStartX - touchEndX;
            
            if (Math.abs(diff) > 50) {
                if (diff > 0) {
                    this.nextSlide();
                } else {
                    this.prevSlide();
                }
            }
        });
    }
    
    nextSlide() {
        console.log('Next slide');
        // Will implement slide transition
    }
    
    prevSlide() {
        console.log('Previous slide');
        // Will implement slide transition
    }
    
    goToSlide(index) {
        console.log(`Go to slide ${index}`);
        // Will implement slide transition
    }
}

// Initialize slide deck
document.addEventListener('DOMContentLoaded', () => {
    new SlideDeck();
});
