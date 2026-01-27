'use client';

import { useRef, useEffect } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import Link from 'next/link';
import { ArrowRight, Github, Star, Zap } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

export function FinalCTA() {
  const container = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const subtitleRef = useRef<HTMLParagraphElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);
  const magneticBtnsRef = useRef<(HTMLAnchorElement | null)[]>([]);
  const particlesRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    if (!container.current) return;

    // Card animation
    gsap.fromTo(cardRef.current,
      { opacity: 0, scale: 0.95, y: 50 },
      {
        opacity: 1,
        scale: 1,
        y: 0,
        duration: 1,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: cardRef.current,
          start: 'top 80%',
        }
      }
    );

    // Title animation with split text effect
    gsap.fromTo(titleRef.current,
      { opacity: 0, y: 40 },
      {
        opacity: 1,
        y: 0,
        duration: 1,
        delay: 0.2,
        ease: 'power3.out'
      }
    );

    // Subtitle
    gsap.fromTo(subtitleRef.current,
      { opacity: 0, y: 30 },
      {
        opacity: 1,
        y: 0,
        duration: 1,
        delay: 0.4,
        ease: 'power3.out'
      }
    );

    // CTA buttons
    const buttons = ctaRef.current?.querySelectorAll('a');
    if (buttons) {
      gsap.fromTo(buttons,
        { opacity: 0, y: 20 },
        {
          opacity: 1,
          y: 0,
          duration: 0.8,
          stagger: 0.1,
          delay: 0.6,
          ease: 'power3.out'
        }
      );
    }

    // Floating particles
    const particles = particlesRef.current?.querySelectorAll('.particle');
    particles?.forEach((particle, i) => {
      gsap.to(particle, {
        y: 'random(-30, 30)',
        x: 'random(-20, 20)',
        opacity: 'random(0.2, 0.6)',
        duration: 'random(4, 8)',
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
        delay: i * 0.3
      });
    });

    // Pulse animation for the top bar
    const topBar = cardRef.current?.querySelector('.top-bar');
    if (topBar) {
      gsap.to(topBar, {
        scaleX: 1.2,
        opacity: 0.8,
        duration: 2,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut'
      });
    }

  }, { scope: container });

  // Magnetic button effect
  useEffect(() => {
    magneticBtnsRef.current.forEach(btn => {
      if (!btn) return;

      const handleMouseMove = (e: MouseEvent) => {
        const rect = btn.getBoundingClientRect();
        const x = e.clientX - rect.left - rect.width / 2;
        const y = e.clientY - rect.top - rect.height / 2;

        gsap.to(btn, {
          x: x * 0.4,
          y: y * 0.4,
          duration: 0.3,
          ease: 'power2.out'
        });
      };

      const handleMouseLeave = () => {
        gsap.to(btn, {
          x: 0,
          y: 0,
          duration: 0.6,
          ease: 'elastic.out(1, 0.3)'
        });
      };

      btn.addEventListener('mousemove', handleMouseMove);
      btn.addEventListener('mouseleave', handleMouseLeave);

      return () => {
        btn.removeEventListener('mousemove', handleMouseMove);
        btn.removeEventListener('mouseleave', handleMouseLeave);
      };
    });
  }, []);

  return (
    <section ref={container} className="w-full py-32 px-6 relative overflow-hidden">
      <div className="mx-auto max-w-5xl">
        <div
          ref={cardRef}
          className="relative overflow-hidden rounded-[3rem] border border-zinc-800/50 bg-gradient-to-b from-zinc-900/80 to-black/80 backdrop-blur-xl p-12 sm:p-20 text-center"
          style={{
            boxShadow: '0 0 100px rgba(59,130,246,0.1), inset 0 1px 0 rgba(255,255,255,0.05)'
          }}
        >
          {/* Top accent bar */}
          <div className="top-bar absolute top-0 left-1/2 -translate-x-1/2 h-1 w-24 bg-gradient-to-r from-blue-500 via-purple-500 to-cyan-500 rounded-full blur-sm" />

          {/* Floating particles */}
          <div ref={particlesRef} className="absolute inset-0 pointer-events-none overflow-hidden">
            {[...Array(15)].map((_, i) => (
              <div
                key={i}
                className="particle absolute rounded-full"
                style={{
                  width: Math.random() * 4 + 2 + 'px',
                  height: Math.random() * 4 + 2 + 'px',
                  left: Math.random() * 100 + '%',
                  top: Math.random() * 100 + '%',
                  background: i % 3 === 0 ? 'rgba(59, 130, 246, 0.5)' : i % 3 === 1 ? 'rgba(168, 85, 247, 0.4)' : 'rgba(6, 182, 212, 0.3)'
                }}
              />
            ))}
          </div>

          {/* Content */}
          <div className="relative z-10">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-zinc-800 bg-zinc-950/50 mb-8">
              <Zap className="h-4 w-4 text-yellow-500" />
              <span className="text-sm text-zinc-400">Open Source • MIT License</span>
            </div>

            {/* Title */}
            <h2
              ref={titleRef}
              className="text-4xl sm:text-5xl lg:text-7xl font-bold tracking-tight text-white mb-6"
            >
              Start Processing{' '}
              <span className="block mt-2 bg-gradient-to-r from-blue-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
                at Scale
              </span>
            </h2>

            {/* Subtitle */}
            <p
              ref={subtitleRef}
              className="text-lg sm:text-xl text-zinc-400 max-w-2xl mx-auto leading-relaxed"
            >
              Join developers building high-performance workflow systems with SPANE.
              Battle-tested infrastructure, developer-friendly APIs.
            </p>

            {/* CTA Buttons */}
            <div ref={ctaRef} className="mt-12 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                ref={(el) => { magneticBtnsRef.current[0] = el; }}
                href="/docs/getting-started"
                className="group relative inline-flex items-center gap-3 overflow-hidden rounded-full bg-white px-10 py-5 text-black font-bold text-lg transition-transform hover:scale-105 active:scale-95"
                style={{ boxShadow: '0 0 40px rgba(255,255,255,0.2)' }}
              >
                <span>Get Started</span>
                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
              </Link>

              <Link
                ref={(el) => { magneticBtnsRef.current[1] = el; }}
                href="https://github.com/manyeya/spane"
                target="_blank"
                className="group inline-flex items-center gap-3 rounded-full border border-zinc-700 bg-zinc-900/50 px-8 py-5 text-zinc-300 font-semibold transition-all hover:bg-zinc-800 hover:border-zinc-600"
              >
                <Github className="h-5 w-5" />
                <span>GitHub</span>
                <div className="flex items-center gap-1 text-yellow-500">
                  <Star className="h-4 w-4 fill-current" />
                  <span className="text-sm">Star</span>
                </div>
              </Link>
            </div>

            {/* Trust indicators */}
            <div className="mt-12 flex flex-wrap items-center justify-center gap-6 text-sm text-zinc-600">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                <span>Production Ready</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-blue-500" />
                <span>TypeScript First</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-purple-500" />
                <span>BullMQ Powered</span>
              </div>
            </div>
          </div>

          {/* Decorative glows */}
          <div className="absolute -bottom-32 -left-32 h-96 w-96 rounded-full bg-blue-500/10 blur-[120px]" />
          <div className="absolute -top-32 -right-32 h-96 w-96 rounded-full bg-purple-500/10 blur-[120px]" />
        </div>

        {/* Footer note */}
        <p className="text-center text-zinc-600 text-sm mt-8">
          Built with love for the open source community
        </p>
      </div>

      {/* Background decoration */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[600px] w-[600px] rounded-full bg-gradient-to-r from-blue-500/5 via-purple-500/5 to-cyan-500/5 blur-[150px]" />
      </div>
    </section>
  );
}
