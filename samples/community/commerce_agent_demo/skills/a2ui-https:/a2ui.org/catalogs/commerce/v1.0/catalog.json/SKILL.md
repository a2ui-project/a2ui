---
name: a2ui-https://a2ui.org/catalogs/commerce/v1.0/catalog.json
description: UI component catalog signatures for https://a2ui.org/catalogs/commerce/v1.0/catalog.json.
metadata:
  protocol_version: 0.9.1
  inference_format: express
  catalog: https://a2ui.org/catalogs/commerce/v1.0/catalog.json
---

## Positional Component Signatures

Use these exact positional signatures to instantiate components. Do not output property keys:
• CartSummary(items? (static), subtotal (static), tax? (static), total (static), checkoutAction (static))
  - Description: Shopping cart overview panel with items breakdown and checkout action.
  - items: List of cart items.
    List of maps keys:
    * title
    * price
    * quantity
  - checkoutAction: Action event triggered when user clicks Proceed to Checkout.
• InventoryBadge(quantity (static), status (static))
  - Description: Visual inventory status badge for product availability.
  - quantity: Units available in stock.
  - status: Status level. Must be one of: 'in_stock', 'low_stock', 'out_of_stock'
• PriceTag(amount (static), currency (static), discountPercent? (static))
  - Description: Formatted price tag with optional list price and discount badge.
  - amount: Current price amount.
  - currency: Currency code (e.g. USD).
  - discountPercent: Discount percentage (e.g. 15 for 15% off).
• ProductCard(title (static), price (static), image? (static), inStock? (static), rating? (static), action (static))
  - Description: Renders a product showcase card with title, price, image thumbnail, stock badge, star rating, and action trigger.
  - title: Name or title of the product.
  - price: Price amount in USD.
  - image: URL to product thumbnail image.
  - inStock: Whether the product is currently in stock.
  - rating: Average star rating (e.g. 4.8).
  - action: Action event triggered when clicking View Details or Add to Cart.
• ProductGrid(children, columns? (static))
  - Description: Responsive grid layout container for displaying product cards.
  - children: List of ProductCard component IDs to display in grid.
  - columns: Number of grid columns (default: 3).

## Positional Function Signatures

Use these exact positional signatures to instantiate check rules or logic functions:

