export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      aria-label="Loading"
      style={{ width: size, height: size }}
      className="inline-block rounded-full border-2 border-current border-t-transparent animate-spin"
    />
  );
}
