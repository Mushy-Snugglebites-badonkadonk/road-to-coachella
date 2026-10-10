import { privateEasterEggImage } from "../../../private-media";

export function GET(request: Request) {
  return privateEasterEggImage(request);
}
