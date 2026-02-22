package com.ideatosvg.app

import android.util.Log
import com.android.billingclient.api.*
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.*

@CapacitorPlugin(name = "BillingPlugin")
class BillingPlugin : Plugin() {

    private var billingClient: BillingClient? = null
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var pendingPurchaseCall: PluginCall? = null

    companion object {
        private const val TAG = "BillingPlugin"
    }

    override fun load() {
        billingClient = BillingClient.newBuilder(context)
            .setListener(purchasesUpdatedListener)
            .enablePendingPurchases()
            .build()

        startConnection()
    }

    private fun startConnection() {
        billingClient?.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                    Log.d(TAG, "Billing client connected")
                } else {
                    Log.e(TAG, "Billing setup failed: ${result.debugMessage}")
                }
            }

            override fun onBillingServiceDisconnected() {
                Log.w(TAG, "Billing service disconnected, will retry on next call")
            }
        })
    }

    private val purchasesUpdatedListener = PurchasesUpdatedListener { billingResult, purchases ->
        val call = pendingPurchaseCall
        pendingPurchaseCall = null

        when (billingResult.responseCode) {
            BillingClient.BillingResponseCode.OK -> {
                if (purchases != null && purchases.isNotEmpty()) {
                    val purchase = purchases[0]
                    val result = JSObject().apply {
                        put("purchaseToken", purchase.purchaseToken)
                        put("productId", purchase.products[0])
                        put("orderId", purchase.orderId ?: "")
                    }
                    call?.resolve(result)
                } else {
                    call?.reject("Purchase succeeded but no purchases returned")
                }
            }
            BillingClient.BillingResponseCode.USER_CANCELED -> {
                call?.reject("Purchase cancelled by user")
            }
            else -> {
                call?.reject("Purchase failed: ${billingResult.debugMessage}")
            }
        }
    }

    @PluginMethod
    fun queryProducts(call: PluginCall) {
        val productIds = call.getArray("productIds")
        if (productIds == null) {
            call.reject("productIds is required")
            return
        }

        val ids = mutableListOf<String>()
        for (i in 0 until productIds.length()) {
            ids.add(productIds.getString(i))
        }

        ensureConnected {
            val productList = ids.map { id ->
                QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(id)
                    .setProductType(BillingClient.ProductType.INAPP)
                    .build()
            }

            val params = QueryProductDetailsParams.newBuilder()
                .setProductList(productList)
                .build()

            billingClient?.queryProductDetailsAsync(params) { billingResult, productDetailsList ->
                if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                    val products = JSArray()
                    for (details in productDetailsList) {
                        val pricing = details.oneTimePurchaseOfferDetails
                        val product = JSObject().apply {
                            put("productId", details.productId)
                            put("title", details.title)
                            put("description", details.description)
                            put("price", pricing?.formattedPrice ?: "N/A")
                            put("priceAmountMicros", pricing?.priceAmountMicros ?: 0L)
                            put("priceCurrencyCode", pricing?.priceCurrencyCode ?: "USD")
                        }
                        products.put(product)
                    }

                    val result = JSObject()
                    result.put("products", products)
                    call.resolve(result)
                } else {
                    call.reject("Failed to query products: ${billingResult.debugMessage}")
                }
            }
        }
    }

    @PluginMethod
    fun purchaseProduct(call: PluginCall) {
        val productId = call.getString("productId")
        if (productId == null) {
            call.reject("productId is required")
            return
        }

        ensureConnected {
            // First query the product details
            val productList = listOf(
                QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(productId)
                    .setProductType(BillingClient.ProductType.INAPP)
                    .build()
            )

            val params = QueryProductDetailsParams.newBuilder()
                .setProductList(productList)
                .build()

            billingClient?.queryProductDetailsAsync(params) { billingResult, productDetailsList ->
                if (billingResult.responseCode != BillingClient.BillingResponseCode.OK || productDetailsList.isEmpty()) {
                    call.reject("Product not found: $productId")
                    return@queryProductDetailsAsync
                }

                val productDetails = productDetailsList[0]
                val flowParams = BillingFlowParams.newBuilder()
                    .setProductDetailsParamsList(
                        listOf(
                            BillingFlowParams.ProductDetailsParams.newBuilder()
                                .setProductDetails(productDetails)
                                .build()
                        )
                    )
                    .build()

                pendingPurchaseCall = call
                val activity = this@BillingPlugin.activity
                billingClient?.launchBillingFlow(activity, flowParams)
            }
        }
    }

    @PluginMethod
    fun getPendingPurchases(call: PluginCall) {
        ensureConnected {
            val params = QueryPurchasesParams.newBuilder()
                .setProductType(BillingClient.ProductType.INAPP)
                .build()

            billingClient?.queryPurchasesAsync(params) { billingResult, purchaseList ->
                val purchases = JSArray()
                if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                    for (purchase in purchaseList) {
                        if (!purchase.isAcknowledged) {
                            val p = JSObject().apply {
                                put("purchaseToken", purchase.purchaseToken)
                                put("productId", purchase.products[0])
                                put("orderId", purchase.orderId ?: "")
                            }
                            purchases.put(p)
                        }
                    }
                }
                val result = JSObject()
                result.put("purchases", purchases)
                call.resolve(result)
            }
        }
    }

    private fun ensureConnected(action: () -> Unit) {
        if (billingClient?.isReady == true) {
            action()
        } else {
            billingClient?.startConnection(object : BillingClientStateListener {
                override fun onBillingSetupFinished(result: BillingResult) {
                    if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                        action()
                    }
                }

                override fun onBillingServiceDisconnected() {
                    Log.w(TAG, "Billing service disconnected during ensureConnected")
                }
            })
        }
    }

    override fun handleOnDestroy() {
        scope.cancel()
        billingClient?.endConnection()
        billingClient = null
        super.handleOnDestroy()
    }
}
