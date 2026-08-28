import Link from "next/link";

export default function Home() {
  return (
    <main className="shell">
      <p className="eyebrow">3D Office · WebMCP</p>
      <h1>A shared room for decisions that need more than a chat.</h1>
      <p className="lede">
        This baseline locks the shared room contract before the core and 3D
        experience workstreams diverge. Both views below read the same room
        state through the same client.
      </p>
      <Link className="button" href="/room/demo">
        Open the 3D office
      </Link>
      <Link className="button button-secondary" href="/room/demo/plan">
        Open the 2D floor plan
      </Link>
    </main>
  );
}
