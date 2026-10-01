import Image from "next/image"

const LOGO_WIDTH = 1006
const LOGO_HEIGHT = 282

export function Logo({ className }: { className?: string }) {
  return (
    <Image
      src="/gatta-logo.png"
      alt="قَطّة"
      width={LOGO_WIDTH}
      height={LOGO_HEIGHT}
      priority
      className={className}
    />
  )
}
