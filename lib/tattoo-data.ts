import { StatueImage, Tattoo } from './types';

// Placeholder tattoo data - easily swappable with Supabase query
export const placeholderTattoos: Tattoo[] = [
  {
    id: '1',
    title: 'Dragon Wing',
    imageUrl: 'https://images.unsplash.com/photo-1611591437281-460bfbe1220a?w=500&h=600&fit=crop&q=80',
    createdAt: '2025-01-10',
    published: true,
  },
  {
    id: '2',
    title: 'Geometric Pattern',
    imageUrl: 'https://images.unsplash.com/photo-1598805917459-0d5e5f59bcb3?w=500&h=600&fit=crop&q=80',
    createdAt: '2025-01-08',
    published: true,
  },
  {
    id: '3',
    title: 'Rose Flower',
    imageUrl: 'https://images.unsplash.com/photo-1598808503371-14646952cf14?w=500&h=600&fit=crop&q=80',
    createdAt: '2025-01-05',
    published: true,
  },
  {
    id: '4',
    title: 'Skull Art',
    imageUrl: 'https://images.unsplash.com/photo-1573929029529-a7e6f4ff7b20?w=500&h=600&fit=crop&q=80',
    createdAt: '2025-01-01',
    published: true,
  },
  {
    id: '5',
    title: 'Mountain Peaks',
    imageUrl: 'https://images.unsplash.com/photo-1618895917646-f0adf6e4cd10?w=500&h=600&fit=crop&q=80',
    createdAt: '2024-12-28',
    published: true,
  },
  {
    id: '6',
    title: 'Ocean Wave',
    imageUrl: 'https://images.unsplash.com/photo-1589784981268-9ab31f6d0e40?w=500&h=600&fit=crop&q=80',
    createdAt: '2024-12-25',
    published: true,
  },
];

// Statue assets - 4 views (male/female × front/back)
export const statueAssets: StatueImage[] = [
  {
    gender: 'male',
    view: 'front',
    label: 'Male - Front',
    imageUrl: 'https://images.unsplash.com/photo-1578324383196-94ae1a3ce896?w=600&h=800&fit=crop&q=80',
  },
  {
    gender: 'male',
    view: 'back',
    label: 'Male - Back',
    imageUrl: 'https://images.unsplash.com/photo-1578324383196-94ae1a3ce896?w=600&h=800&fit=crop&q=80',
  },
  {
    gender: 'female',
    view: 'front',
    label: 'Female - Front',
    imageUrl: 'https://images.unsplash.com/photo-1578324383196-94ae1a3ce896?w=600&h=800&fit=crop&q=80',
  },
  {
    gender: 'female',
    view: 'back',
    label: 'Female - Back',
    imageUrl: 'https://images.unsplash.com/photo-1578324383196-94ae1a3ce896?w=600&h=800&fit=crop&q=80',
  },
];

export function getStatueImage(gender: 'male' | 'female', view: 'front' | 'back'): StatueImage | undefined {
  return statueAssets.find(s => s.gender === gender && s.view === view);
}

// Hook for fetching tattoos - easily swappable with Supabase
export async function fetchTattoos(): Promise<Tattoo[]> {
  // TODO: Replace with Supabase query:
  // const { data, error } = await supabase
  //   .from('tattoos')
  //   .select('*')
  //   .eq('published', true)
  //   .order('createdAt', { ascending: false });
  
  return new Promise((resolve) => {
    // Simulate network delay
    setTimeout(() => {
      resolve(placeholderTattoos);
    }, 300);
  });
}

export async function fetchTattooById(id: string): Promise<Tattoo | null> {
  // TODO: Replace with Supabase query:
  // const { data, error } = await supabase
  //   .from('tattoos')
  //   .select('*')
  //   .eq('id', id)
  //   .single();
  
  const tattoo = placeholderTattoos.find(t => t.id === id);
  return tattoo || null;
}
