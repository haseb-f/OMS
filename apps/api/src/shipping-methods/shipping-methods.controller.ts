import { GoneException, Controller, UseGuards, All } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

/**
 * Shipping Methods retired — operational shipping uses ShippingCompany.
 * Catch-all returns 410 Gone so old clients are steered explicitly.
 */
@Controller('shipping-methods')
@UseGuards(JwtAuthGuard)
export class ShippingMethodsController {
  @All('*')
  gone(): never {
    throw new GoneException(
      'Shipping Methods have been retired. Use Shipping Companies instead.',
    );
  }

  @All()
  goneRoot(): never {
    throw new GoneException(
      'Shipping Methods have been retired. Use Shipping Companies instead.',
    );
  }
}
