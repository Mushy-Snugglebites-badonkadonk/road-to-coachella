import { privateEasterEggAudio } from "../../../private-media";

export function GET(request: Request) {
  return privateEasterEggAudio(request);
}
