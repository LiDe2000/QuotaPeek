export type ExpandSide = "left" | "right";
export interface PlacementInput {
  x: number;
  currentWidth: number;
  targetWidth: number;
  railWidth: number;
  inset: number;
  screenLeft: number;
  screenWidth: number;
  side: ExpandSide;
}

/** Preserve the rail's position when changing width or opening direction. */
export function horizontalPlacement(input: PlacementInput): { x: number; side: ExpandSide } {
  const { x, currentWidth, targetWidth, railWidth, inset, screenLeft, screenWidth, side } = input;
  const railLeft = side === "left" ? x + currentWidth - inset - railWidth : x + inset;
  const rightX = railLeft - inset;
  const leftX = railLeft + railWidth + inset - targetWidth;
  const screenRight = screenLeft + screenWidth;
  const fitsRight = rightX + targetWidth <= screenRight;
  const fitsLeft = leftX >= screenLeft;
  const nextSide = side === "right" ? (fitsRight || !fitsLeft ? "right" : "left") : (fitsLeft || !fitsRight ? "left" : "right");
  const wantedX = nextSide === "left" ? leftX : rightX;
  return { side: nextSide, x: Math.max(screenLeft, Math.min(wantedX, screenRight - targetWidth)) };
}

/** Screen coordinates stay physical; only CSS widths use the window's current DPI. */
export function physicalHorizontalPlacement(input: PlacementInput & { scaleFactor: number }): { x: number; side: ExpandSide } {
  const { scaleFactor, currentWidth, targetWidth, railWidth, inset } = input;
  const placement = horizontalPlacement({ ...input, currentWidth: currentWidth * scaleFactor,
    targetWidth: targetWidth * scaleFactor, railWidth: railWidth * scaleFactor, inset: inset * scaleFactor });
  return { ...placement, x: Math.round(placement.x) };
}
