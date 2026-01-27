'use client';

import { useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import Link from 'next/link';
import { Github, Heart } from 'lucide-react';

export function Footer() {
  const container = useRef<HTMLElement>(null);
  const logoRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);
  const linksRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    if (!container.current) return;

    gsap.fromTo([logoRef.current, textRef.current, linksRef.current],
      { opacity: 0, y: 20 },
      {
        opacity: 1,
        y: 0,
        duration: 0.8,
        stagger: 0.1,
        ease: 'power2.out'
      }
    );
  }, { scope: container });

  return (
    <footer
      ref={container}
      className="w-full border-t border-zinc-800/50 bg-black py-12 px-6"
    >
      <div className="mx-auto max-w-6xl flex flex-col items-center justify-between gap-6 sm:flex-row">
        {/* Logo */}
        <div
          ref={logoRef}
          className="flex items-center gap-3 group cursor-pointer"
        >
          <div className="relative h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center overflow-hidden">
            <span className="text-white font-bold text-sm">S</span>
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
          </div>
          <span className="text-lg font-bold text-white">SPANE</span>
        </div>

        {/* Copyright */}
        <p
          ref={textRef}
          className="flex items-center gap-1.5 text-sm text-zinc-500"
        >
          © {new Date().getFullYear()} SPANE Engine
          <Heart className="h-3.5 w-3.5 fill-red-500 text-red-500" />
        </p>

        {/* Links */}
        <div
          ref={linksRef}
          className="flex items-center gap-6"
        >
          <Link
            href="https://github.com/manyeya/spane"
            target="_blank"
            className="flex items-center gap-2 text-sm text-zinc-500 hover:text-white transition-colors group"
          >
            <Github className="h-4 w-4 group-hover:scale-110 transition-transform" />
            <span>GitHub</span>
          </Link>
          <Link
            href="/docs/getting-started"
            className="text-sm text-zinc-500 hover:text-white transition-colors"
          >
            Documentation
          </Link>
        </div>
      </div>
    </footer>
  );
}
