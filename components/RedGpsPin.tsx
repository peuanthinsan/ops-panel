import Svg, { Circle, Path, Rect } from 'react-native-svg';

/** Exact pin artwork used by the Songdee SVIS wordmark. */
export function RedGpsPin({ size = 36 }: { size?: number }) {
  return (
    <Svg accessible={false} width={size} height={size} viewBox="0 0 180 220">
      <Path d="M90 4C42.5 4 4 42.5 4 90c0 61.8 86 126 86 126s86-64.2 86-126C176 42.5 137.5 4 90 4Z" fill="#ed1c24" />
      <Circle cx="90" cy="84" r="59" fill="#fff" />
      <Rect x="52" y="46" width="76" height="30" fill="#292929" />
      <Rect x="52" y="93" width="76" height="29" fill="#292929" />
      <Path d="M52 52 128 97v25L52 77Z" fill="#ed1c24" />
    </Svg>
  );
}
