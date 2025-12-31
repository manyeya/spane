export function Footer() {
    return (
        <footer className="w-full border-t border-zinc-800 bg-black py-12 px-6">
            <div className="mx-auto max-w-6xl flex flex-col items-center justify-between gap-6 sm:flex-row">
                <div className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded bg-white" />
                    <span className="text-lg font-bold text-white">SPANE</span>
                </div>

                <p className="text-sm text-zinc-500">
                    © {new Date().getFullYear()} SPANE Engine. Parallel node execution, simplified.
                </p>

                <div className="flex gap-6">
                    <a href="https://github.com/manyeya/spane" className="text-zinc-500 hover:text-white transition-colors">GitHub</a>
                    <a href="/docs/getting-started" className="text-zinc-500 hover:text-white transition-colors">Documentation</a>
                </div>
            </div>
        </footer>
    );
}
