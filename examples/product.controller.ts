import {
  Controller,
  GetMapping,
  PathVariable,
  RequestParam,
} from '../src/index.js';

interface Product {
  id: string;
  name: string;
}

const products: Product[] = [
  { id: '1', name: 'Widget' },
  { id: '2', name: 'Gadget' },
];

@Controller('/api/v1/products')
export class ProductController {
  @GetMapping('/')
  all(@RequestParam('q') q: string = '') {
    if (!q) return products;
    return products.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
  }

  @GetMapping('/:id')
  one(@PathVariable('id') id: string) {
    return products.find((p) => p.id === id) ?? null;
  }

  @GetMapping('/:id/reviews/:reviewId')
  review(
    @PathVariable('id') id: string,
    @PathVariable('reviewId') reviewId: string,
  ) {
    return { productId: id, reviewId, body: `Review ${reviewId} of product ${id}` };
  }
}