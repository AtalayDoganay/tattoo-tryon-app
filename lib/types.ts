export interface Shop {
  id: string;
  name: string;
  slug: string;
  ownerUserId: string;
  designCount?: number;
}

export interface Tattoo {
  id: string;
  title: string;
  imageUrl: string;
  createdAt: string;
  published: boolean;
}

export interface DbTattoo {
  id: string;
  shop_id: string;
  name: string;
  style: string | null;
  description: string | null;
  image_url: string;
  created_at: string;
  /**
   * False hides the row from everyone except the owning shop's manager.
   * New rows default to false in the database; the RLS policy
   * "tattoos: published read" is what actually enforces this, so a public
   * screen that forgets to filter still cannot receive a draft.
   */
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
