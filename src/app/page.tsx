import Link from "next/link";

export default function Home() {
  return (
    <main className="shell">
      <p className="eyebrow">3D Office · WebMCP</p>
      <h1>A shared room for decisions that need more than a chat.</h1>
      <p className="lede">
        This baseline locks the shared room contract before the core and 3D
        experience workstreams diverge.
      </p>
      <Link className="button" href="/room/demo">
        Open demo room
      </Link>
    </main>
  );
}
