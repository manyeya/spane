'use client';

import { useRef, useEffect } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import Link from 'next/link';
import { Github, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Hero() {
  const container = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const titleWordsRef = useRef<(HTMLSpanElement | null)[]>([]);
  const subtitleRef = useRef<HTMLParagraphElement>(null);
  const badgeRef = useRef<HTMLDivElement>(null);
  const ctaContainerRef = useRef<HTMLDivElement>(null);
  const ctaRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const codeRef = useRef<HTMLDivElement>(null);
  const underlineRef = useRef<HTMLDivElement>(null);
  const particlesRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    if (!container.current) return;

    // Elements start with inline styles for hidden state, preventing flash
    // No need for gsap.set() - animate directly from initial inline styles
    const tl = gsap.timeline({ defaults: { ease: 'power4.out' } });

    // Step 1: Badge appears with scale
    tl.to(badgeRef.current, { opacity: 1, scale: 1, y: 0, duration: 0.6, ease: 'back.out(1.7)' }, 0);

    // Step 2: Title words cascade - overlapping for fluid feel
    titleWordsRef.current.forEach((word, i) => {
      if (word) {
        tl.to(word, { y: 0, opacity: 1, rotationX: 0, duration: 0.8, ease: 'power3.out' }, 0.2 + (i * 0.08));
      }
    });

    // Step 3: Underline expands from center
    tl.to(underlineRef.current, { scaleX: 1, opacity: 1, duration: 0.6, ease: 'power2.out' }, '-=0.3');

    // Step 4: Subtitle fades in smoothly
    tl.to(subtitleRef.current, { opacity: 1, y: 0, duration: 0.8, ease: 'power2.out' }, '-=0.4');

    // Step 5: CTA buttons slide up together
    ctaRefs.current.forEach((btn) => {
      if (btn) {
        tl.to(btn, { y: 0, opacity: 1, duration: 0.6, ease: 'power3.out' }, '-=0.5');
      }
    });

    // Step 6: Code block appears with bounce
    tl.to(codeRef.current, { y: 0, opacity: 1, scale: 1, duration: 0.7, ease: 'back.out(1.2)' }, '-=0.3');

    // Ambient floating particles - continuous
    const particles = particlesRef.current?.querySelectorAll('.particle');
    particles?.forEach((particle, i) => {
      gsap.to(particle, {
        y: 'random(-40, 40)',
        x: 'random(-20, 20)',
        opacity: 'random(0.2, 0.6)',
        duration: 'random(4, 7)',
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
        delay: i * 0.15
      });
    });

    // Ambient glow pulse
    const glow = container.current.querySelector('.hero-glow');
    if (glow) {
      gsap.to(glow, {
        scale: 1.15,
        opacity: 0.5,
        duration: 4,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut'
      });
    }

  }, { scope: container });

  // Magnetic button effect - more subtle and smooth
  useEffect(() => {
    ctaRefs.current.forEach(btn => {
      if (!btn) return;

      const handleMouseMove = (e: MouseEvent) => {
        const rect = btn.getBoundingClientRect();
        const x = (e.clientX - rect.left - rect.width / 2) * 0.25;
        const y = (e.clientY - rect.top - rect.height / 2) * 0.25;

        gsap.to(btn, {
          x,
          y,
          duration: 0.4,
          ease: 'power2.out'
        });
      };

      const handleMouseLeave = () => {
        gsap.to(btn, {
          x: 0,
          y: 0,
          duration: 0.6,
          ease: 'elastic.out(1, 0.5)'
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

  const titleText = [
    { text: 'Parallel', highlight: false },
    { text: 'Node', highlight: true },
    { text: 'Execution,', highlight: false },
    { text: 'Simplified.', highlight: false }
  ];

  return (
    <section ref={container} className="relative flex min-h-[100vh] flex-col items-center justify-center overflow-hidden px-6 pt-20 pb-16 text-center">
      {/* Background layers */}
      <div className="absolute inset-0 z-0">
        {/* Main glow */}
        <div className="hero-glow absolute top-1/2 left-1/2 h-[700px] w-[700px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500/15 blur-[150px]" />

        {/* Secondary accent glows */}
        <div className="absolute top-1/4 left-1/4 h-[400px] w-[400px] rounded-full bg-purple-500/10 blur-[120px] animate-pulse-glow" />
        <div className="absolute bottom-1/3 right-1/4 h-[350px] w-[350px] rounded-full bg-cyan-500/10 blur-[100px] animate-pulse-glow" style={{ animationDelay: '1s' }} />

        {/* Floating particles */}
        <div ref={particlesRef} className="absolute inset-0 overflow-hidden">
          {[...Array(25)].map((_, i) => (
            <div
              key={i}
              className="particle absolute rounded-full"
              style={{
                width: Math.random() * 5 + 2 + 'px',
                height: Math.random() * 5 + 2 + 'px',
                left: Math.random() * 100 + '%',
                top: Math.random() * 100 + '%',
                background: i % 3 === 0 ? 'rgba(59, 130, 246, 0.6)' : i % 3 === 1 ? 'rgba(168, 85, 247, 0.5)' : 'rgba(6, 182, 212, 0.4)',
                opacity: Math.random() * 0.5 + 0.2
              }}
            />
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="z-10 flex flex-col items-center max-w-5xl">
        {/* Badge */}
        <div
          ref={badgeRef}
          className="mb-10 inline-flex items-center gap-2 rounded-full border border-zinc-800/80 bg-zinc-950/80 px-5 py-2.5 text-sm font-medium text-zinc-400 backdrop-blur-md shadow-lg"
          style={{ opacity: 0, transform: 'scale(0.8) translateY(-10px)' }}
        >
          <span className="relative flex h-2 w-2">
            <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
          </span>
          <span>v0.1.1</span>
          <span className="text-zinc-700">•</span>
          <span className="text-amber-500">Experimental</span>
        </div>

        {/* Title */}
        <div ref={titleRef} className="mb-6">
          <h1 className="font-bold tracking-tight sm:text-7xl lg:text-8xl" style={{ fontSize: 'clamp(2.5rem, 8vw, 5rem)', lineHeight: 1.1 }}>
            {titleText.map((word, i) => (
              <span
                key={i}
                ref={(el) => { titleWordsRef.current[i] = el; }}
                className={cn(
                  'inline-block mr-3 sm:mr-4 perspective-1000',
                  word.highlight ? 'text-white relative' : 'text-zinc-200'
                )}
                style={{ display: 'inline-block', opacity: 0, transform: 'translateY(80px) rotateX(-15deg)' }}
              >
                {word.text}
                {word.highlight && (
                  <>
                    <span className="absolute -inset-4 rounded-full bg-blue-500/20 blur-3xl -z-10" />
                    <span className="absolute inset-0 bg-gradient-to-r from-blue-500/20 via-purple-500/20 to-cyan-500/20 bg-clip-text" />
                  </>
                )}
              </span>
            ))}
          </h1>
        </div>

        {/* Animated underline */}
        <div ref={underlineRef} className="relative h-0.5 w-32 overflow-hidden rounded-full" style={{ opacity: 0, transform: 'scaleX(0)' }}>
          <div className="absolute inset-0 bg-gradient-to-r from-blue-500 via-purple-500 to-cyan-500" />
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-shimmer" />
        </div>

        {/* Subtitle */}
        <p
          ref={subtitleRef}
          className="mt-8 max-w-2xl text-lg text-zinc-400 sm:text-xl leading-relaxed"
          style={{ opacity: 0, transform: 'translateY(20px)' }}
        >
          A workflow orchestration engine built on{' '}
          <span className="text-zinc-300">BullMQ</span> and{' '}
          <span className="text-zinc-300">Redis</span>. Execute complex DAGs with{' '}
          <span className="text-white font-medium">parallel processing</span>,{' '}
          <span className="text-blue-400 font-medium">smart retries</span>, and{' '}
          <span className="text-purple-400 font-medium">full type safety</span>.
          <span className="block mt-3 text-amber-500/80 text-base">
            APIs may change. Not recommended for production without thorough testing.
          </span>
        </p>

        {/* CTA Buttons */}
        <div ref={ctaContainerRef} className="mt-12 flex flex-wrap items-center justify-center gap-4">
          <Link
            ref={(el) => { ctaRefs.current[0] = el; }}
            href="/docs/getting-started"
            className="group relative inline-flex items-center gap-2.5 overflow-hidden rounded-full bg-white px-10 py-4 text-black font-semibold transition-transform hover:scale-105 active:scale-95 shadow-xl shadow-white/10"
            style={{ opacity: 0, transform: 'translateY(30px)' }}
          >
            <span>Read Docs</span>
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1 group-hover:scale-110" />
            <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
          </Link>

          <Link
            ref={(el) => { ctaRefs.current[1] = el; }}
            href="https://github.com/manyeya/spane"
            target="_blank"
            className="group inline-flex items-center gap-2.5 rounded-full border border-zinc-700/50 bg-zinc-950/80 px-10 py-4 text-zinc-300 backdrop-blur-sm transition-all hover:bg-zinc-900 hover:border-zinc-600 active:scale-95 shadow-lg"
            style={{ opacity: 0, transform: 'translateY(30px)' }}
          >
            <Github className="h-5 w-5 transition-transform group-hover:scale-110" />
            <span className="font-medium">GitHub</span>
          </Link>
        </div>

        {/* Install command */}
        <div
          ref={codeRef}
          className="mt-10 group relative inline-flex items-center gap-3 rounded-2xl border border-zinc-800/80 bg-zinc-950/90 px-6 py-3.5 backdrop-blur-sm transition-all hover:border-zinc-700 hover:shadow-2xl hover:shadow-blue-500/10"
          style={{ opacity: 0, transform: 'translateY(40px) scale(0.95)' }}
        >
          {/* Outer glow on hover */}
          <div className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-blue-500/20 via-purple-500/20 to-cyan-500/20 opacity-0 blur-xl transition-opacity duration-500 group-hover:opacity-100 -z-10" />
          <code className="text-sm font-mono text-zinc-400">
            <span className="text-blue-400">bun</span> add @manyeya/spane
          </code>
          <button
            onClick={() => navigator.clipboard.writeText('bun add @manyeya/spane')}
            className="rounded-xl bg-zinc-900/80 px-4 py-2 text-xs font-medium text-zinc-300 transition-all hover:bg-zinc-800 active:bg-zinc-700 group-hover:bg-blue-600 group-hover:text-white"
          >
            Copy
          </button>
        </div>
      </div>

      {/* Grid background */}
      <div className="absolute inset-0 z-[-1] opacity-15">
        <div className="absolute inset-0 h-full w-full bg-[linear-gradient(to_right,#3f3f46_1px,transparent_1px),linear-gradient(to_bottom,#3f3f46_1px,transparent_1px)] bg-size-[4rem_4rem]" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-black/50 to-black" />
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3 opacity-40">
        <span className="text-xs text-zinc-500 tracking-wide uppercase">Scroll</span>
        <div className="h-10 w-6 rounded-full border-2 border-zinc-700 p-1.5">
          <div className="h-1.5 w-1.5 rounded-full bg-zinc-400 animate-bounce" />
        </div>
      </div>
    </section>
  );
}
