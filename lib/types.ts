export interface Tattoo {
  id: string;
  title: string;
  imageUrl: string;
  createdAt: string;
  published: boolean;
}

export interface TryOnState {
  scale: number;
  rotationZ: number;
  translateX: number;
  translateY: number;
}

export type StatueGender = 'male' | 'female';
export type StatueView = 'front' | 'back';

export interface StatueImage {
  gender: StatueGender;
  view: StatueView;
  imageUrl: string;
  label: string;
}
