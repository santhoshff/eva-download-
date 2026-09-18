import evaMark from "@/assets/eva-mark.png.asset.json";

interface BrandMarkProps {
  compact?: boolean;
}

export function BrandMark({ compact = false }: BrandMarkProps) {
  return (
    <span className="inline-flex items-center gap-2.5" aria-label="Eva Download">
      <img
        src={evaMark.url}
        alt=""
        width={compact ? 34 : 42}
        height={compact ? 34 : 42}
        className={compact ? "size-[34px] object-contain" : "size-[42px] object-contain"}
      />
      <span className="leading-none">
        <span className="block font-display text-[21px] text-ink">Eva</span>
        <span className="mt-1 block font-mono text-[7px] uppercase tracking-[0.28em] text-ink/45">
          Download
        </span>
      </span>
    </span>
  );
}