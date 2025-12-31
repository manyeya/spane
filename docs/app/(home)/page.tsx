import { Hero } from '@/components/landing/Hero';
import { Features } from '@/components/landing/Features';
import { WorkflowVisual } from '@/components/landing/WorkflowVisual';
import { BentoFeatures } from '@/components/landing/BentoFeatures';
import { CodePreview } from '@/components/landing/CodePreview';
import { FinalCTA } from '@/components/landing/FinalCTA';
import { Footer } from '@/components/landing/Footer';

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col bg-black text-white antialiased selection:bg-blue-500/30">
      <Hero />
      <WorkflowVisual />
      <BentoFeatures />
      <Features />
      <CodePreview />
      <FinalCTA />
      <Footer />
    </main>
  );
}
