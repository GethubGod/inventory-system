// Friendly 404: staff land here from mistyped or stale links — point them
// back at the scan gate instead of the framework default.

import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 pb-10">
      <div className="rounded-card bg-card p-5 text-center">
        <p className="font-bold text-ink">That page doesn&apos;t exist</p>
        <p className="mt-2 text-ink2">
          To enter tips, scan the QR code by the register.
        </p>
      </div>
      <Link
        href="/"
        className="mt-6 block w-full rounded-full bg-card py-4 text-center font-semibold text-ink"
      >
        Back to scan
      </Link>
    </main>
  );
}
