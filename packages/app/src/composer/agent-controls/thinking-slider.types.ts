export interface ThinkingSliderProps {
  options: readonly { id: string; label: string }[];
  selectedIndex: number;
  disabled: boolean;
  maxed: boolean;
  onSelect: (index: number) => void;
}
