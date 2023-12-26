'use strict';

/* Definitions */
var controllersCartridge = 'app_storefront_controllers';
var coreCartridge        = 'app_storefront_core';

/* Script Modules */
var app   = require(controllersCartridge + '/cartridge/scripts/app');
var guard = require(controllersCartridge + '/cartridge/scripts/guard');

/* API Includes */
var Transaction = require('dw/system/Transaction');
var URLUtils    = require('dw/web/URLUtils');
var logger		= require ("dw/system").Logger;
var ShippingMgr = require('dw/order/ShippingMgr');

var custom 		= require('~/cartridge/scripts/carriers/custom');
var ups 		= require('~/cartridge/scripts/carriers/ups');
var cloud_ups 		= require('~/cartridge/scripts/carriers/cloudUPS');
var usps 		= require('~/cartridge/scripts/carriers/usps');
var googleAddress = require('*/cartridge/controllers/GoogleAddress');
/* Model */
var CartModel = app.getModel('Cart');

function start(params) {
	let response = {
		"newRates": [],
		"applicableShippingMethods": [],
		"isError": false,
		"errorMessage" : ''
	}, errors = [], weight = 0.0, height = 0.0, width = 0.0, lenght = 0.0, girth = 0.0;
	var isUPSSMFound = false, isUSPSSMFound = false, isGroundApplicable = false;
	try{
		
		var isUPSEnable = dw.system.Site.getCurrent().getCustomPreferenceValue('UPS_Enable');
		var isUSPSEnable = dw.system.Site.getCurrent().getCustomPreferenceValue('usps_enable');
		
		if(params.applicableShippingMethods == null || params.applicableShippingMethods.length <= 0){
			let cart = CartModel.get();	
			 if (!cart || ( !empty(cart.object) && empty(cart.object.allProductLineItems) && empty(cart.object.allGiftCertificateLineItems) )) {
				 	response.isError = true;
					response.errorMessage = 'Cart is empty.';
					return response;	
			 }else{
				 params.applicableShippingMethods = cart.getApplicableShippingMethods(params.address);				 	
			 }			
		}
		
		for (let i = 0; i < params.applicableShippingMethods.length; i++) {	 		
    		if (params.excludeCSCShippingMethods){
    			if(params.applicableShippingMethods[i].custom.isCustomerServiceSM){
    				continue;
    			}
    		}   		
    		let serviceCode = params.applicableShippingMethods[i].custom.serviceCode;   		
    		if (serviceCode != null && serviceCode != ''){   			
    			if(serviceCode == 'UPS') {
    				if(isUPSEnable){
    					isUPSSMFound = true;
    				}else{
    					response.applicableShippingMethods.push(params.applicableShippingMethods[i]);
    				}
    				continue;
    			}
    			if(serviceCode == 'USPS') {
    				if(isUSPSEnable){
    					isUSPSSMFound = true;
    				}else{
    					response.applicableShippingMethods.push(params.applicableShippingMethods[i]);
    				}
    				continue;
    			}
    		}    		
		}
		
		params = populateProdInfo(params);		
		if (params == null){
			response.isError = true;
			response.errorMessage = 'Getting Product Data Error';
			return response;				
		}
		
		var customQuote = null, upsQuote = null, uspsQuote = null, uspsIntQuote = null;
		
		// get custom Quote
		customQuote = custom.GetQuote(params);		
		
		// get ups ship rate quote
		if(isUPSSMFound){
			var stateValue = params.address.stateCode.toUpperCase()
			upsQuote = params.address.countryCode.toUpperCase() == 'US' ? cloud_ups.GetQuote(params) : ups.GetQuote(params);
			if(upsQuote != null && upsQuote !== undefined && stateValue !='PR' && stateValue !='GU' && stateValue !='AS' && stateValue !='VI' && stateValue !='AE' && stateValue !='AP' && stateValue !='AA' ) {
				if ('PrimaryErrorCode' in upsQuote &&  null != upsQuote.PrimaryErrorCode) {
					response.isError = true;
					let error = {"Carrier": 'UPS', "Message": upsQuote.PrimaryErrorCode.Description, "Code": upsQuote.PrimaryErrorCode.Code}
					errors.push(error);				
				}else if('Errors' in upsQuote && upsQuote.Errors != null && upsQuote.Errors.length > 0){
					response.isError = true;
					let error = {"Carrier": 'UPS', "Message": upsQuote.Errors[0].Description, "Code": upsQuote.Errors[0].Code}
					errors.push(error);
				}
			}
		}
 
		if(isUSPSSMFound){
			// get USPS ship rate quote
			uspsQuote = usps.GetQuote(params);
			if(uspsQuote != null && uspsQuote !== undefined){
				if ('Errors' in uspsQuote && uspsQuote.Errors != null && uspsQuote.Errors.length > 0){
					response.isError = true;
					let error = {"Carrier": 'USPS', "Message": uspsQuote.Errors[0].Description, "Code": uspsQuote.Errors[0].Number}
					errors.push(error);
				}
			}
			
			// get USPS international ship rate quote
			uspsIntQuote = usps.GetIntQuote(params);
			if(uspsIntQuote != null && uspsIntQuote.length == 0){
				if (uspsIntQuote.Errors != null && uspsIntQuote.Errors.length > 0){
					response.isError = true;
					let error = {"Carrier": 'USPS', "Message": uspsIntQuote.Errors[0].Description, "Code": uspsIntQuote.Errors[0].Number}
					errors.push(error);
				}
			}
		}		
		    	
    	for (let i = 0; i < params.applicableShippingMethods.length; i++) {
 		
    		if (params.excludeCSCShippingMethods){
    			if(params.applicableShippingMethods[i].custom.isCustomerServiceSM){
    				continue;
    			}
    		}
    		
    		let smID = params.applicableShippingMethods[i].ID;
    		let serviceCode = params.applicableShippingMethods[i].custom.serviceCode;
    		let serviceId = params.applicableShippingMethods[i].custom.serviceId;
    		let serviceName = params.applicableShippingMethods[i].custom.serviceName;
    		let rushFee = params.applicableShippingMethods[i].custom.rushFee;
    		let overrideCost = params.applicableShippingMethods[i].custom.overrideCost;
    		
    		// Ignoring Flat Rate Shipping Methods.
    		if (smID == '009-1' || smID == '009-2'){   
    			continue;
    		}
    		
    		if (serviceCode != null && serviceCode != ''){
    			// CUSTOM
    			if (serviceCode == 'CUSTOM' && customQuote != null && customQuote.length > 0){
    				for (let j = 0; j < customQuote.length; j++) {   		    		
    		    		if(customQuote[j].Code == serviceId){    		    		    		    
    		    			let newRate = parseFloat(customQuote[j].Rate);
    		    			newRate = newRate + rushFee;
    		    			newRate = getOverrideFee(overrideCost, newRate);
    		    			response.newRates.push({"Id":params.applicableShippingMethods[i].ID,"Rate":newRate});
    		    			response.applicableShippingMethods.push(params.applicableShippingMethods[i]);
    		    			break;
    		    		} 		    		
    		    	}    				
    			} // End of CUSTOM Flag Check
    			  		
    			// UPS
    			if (serviceCode == 'UPS' && upsQuote != null && upsQuote.length > 0){    				
    				for (let j = 0; j < upsQuote.length; j++) {   		    		
    		    		if(upsQuote[j].Code == serviceId){    		    		    		    
    		    			let newRate = parseFloat(upsQuote[j].Rate);
    		    			newRate = newRate + rushFee;
    		    			newRate = getOverrideFee(overrideCost, newRate);
    		    			response.newRates.push({"Id":params.applicableShippingMethods[i].ID,"Rate":newRate});
    		    			response.applicableShippingMethods.push(params.applicableShippingMethods[i]);
    		    			response.isError = false;
    	    				if (smID == '001') isGroundApplicable = true;
    		    			break;
    		    		} 		    		
    		    	}    				
    			} // End of UPS Flag Check
    			
    			// USPS
    			if (serviceCode == 'USPS'){
    				var serviceNames = serviceName.split('|');
    				if(uspsQuote != null && uspsQuote.length > 0){
    					// Custom logic, if total product weight < 14 lbs then USPS First-Class Mail 
    					var sWeight = params.shippingWeight != null ? (parseFloat(params.shippingWeight)) : 0;
    					if ( sWeight != 0 && (parseFloat(params.shippingWeight) * 16) >= 14 && smID == '004-2'){ 
    						continue;
    					}
        				let isSMFound = false; 
        				// Local Rates
        				for (let k = 0; k < uspsQuote.length; k++) {  
        					for (let j = 0; j < serviceNames.length; j++){
        						if(serviceNames[j] == uspsQuote[k].Name){
            		    			let newRate = parseFloat(uspsQuote[k].Rate);
            		    			newRate = newRate + rushFee;
            		    			newRate = getOverrideFee(overrideCost, newRate);
            		    			response.newRates.push({"Id":params.applicableShippingMethods[i].ID,"Rate":newRate});
            		    			response.applicableShippingMethods.push(params.applicableShippingMethods[i]);
            		    			isSMFound = true;
            		    			response.isError = false;
            		    			break;
            		    		} 	
        					}
        					if(isSMFound) break;        						
        		    	}
    				} // End of Local Quote Mapping
    				
    				// International Rates
    				isSMFound = false;
    				if(uspsIntQuote != null && uspsIntQuote.length > 0){
        				for (let k = 0; k < uspsIntQuote.length; k++) {   					    				
        					for (let j = 0; j < serviceNames.length; j++){
	        					if(serviceNames[j] == uspsIntQuote[k].Name){
	        		    			let newRate = parseFloat(uspsIntQuote[k].Rate);
	        		    			newRate = newRate + rushFee;
	        		    			newRate = getOverrideFee(overrideCost, newRate);
	        		    			response.newRates.push({"Id":params.applicableShippingMethods[i].ID,"Rate":newRate});
	        		    			response.applicableShippingMethods.push(params.applicableShippingMethods[i]);
	        		    			response.isError = false;
	        		    			isSMFound = true;
	        		    			break;
	        		    		} 	
        					}
        					if(isSMFound) break;
        		    	}
    				} // End of Int Quote Mapping
    			} // End of USPS Flag Check  			
    		}else{
    			response.applicableShippingMethods.push(params.applicableShippingMethods[i]);
    		}
    	}

    	if(params.isOnlyFlatRateItems || isGroundApplicable ){
    		populateFlatRate(params, isUPSSMFound, isUSPSSMFound, response,errors);
    	}
  
    	populateErrorMessage(response, errors);
    	
	}catch(e){
		var error = e;
		logger.getLogger("ShippingCarrier", "ShippingCarrier").error("ShippingCarrier.js-start() : " + error.toString());
	}
	
	return response; 
}

function populateFlatRate(params, isUPSSMFound, isUSPSSMFound, response, errors){
	var upsFRQuote, uspsFRQuote, uspsFRIntQuote;
	// Process for Flat Rate
	if(params.isFlatRateEligible){
		
		// Get Ups Flat Rate
    	if(isUPSSMFound){
			upsFRQuote = ups.GetFlatRateQuote(params);				
			if(upsFRQuote != null && upsFRQuote.length == 0){
				if(upsFRQuote.PrimaryErrorCode != null){
					response.isError = true;
					let error = {"Carrier": 'UPS', "Message": upsFRQuote.PrimaryErrorCode.Description, "Code": upsFRQuote.PrimaryErrorCode.Code}
					errors.push(error);
				}
			}
		}
    	// Get USPS Flat Rate
    	if(isUSPSSMFound){
			// get USPS ship rate quote
    		uspsFRQuote = usps.GetFlateRateQuote(params);
			if(uspsFRQuote != null && uspsFRQuote.length == 0 ){
				if(uspsFRQuote.Errors != null && uspsFRQuote.Errors.length > 0){
					response.isError = true;
					let error = {"Carrier": 'USPS', "Message": uspsFRQuote.Errors[0].Description, "Code": uspsFRQuote.Errors[0].Number}
					errors.push(error);
				}
			}
		}
    	
    	var flatRate = 0.0, groundRate = 0.0;   
		
    	for (let i = 0; i < params.applicableShippingMethods.length; i++) {    		 		
    		let smID = params.applicableShippingMethods[i].ID;
    		let serviceCode = params.applicableShippingMethods[i].custom.serviceCode;
    		let serviceId = params.applicableShippingMethods[i].custom.serviceId;
    		let serviceName = params.applicableShippingMethods[i].custom.serviceName;    		
    		let rushFee = params.applicableShippingMethods[i].custom.rushFee;
    		let overrideCost = params.applicableShippingMethods[i].custom.overrideCost;
		
    		// UPS ground Rate
    		if (smID == '001' && upsFRQuote != null && upsFRQuote.length > 0){    				
    			for (let j = 0; j < upsFRQuote.length; j++) {   		    		
    	    		if(upsFRQuote[j].Code == serviceId){    		    		    		    
    	    			let newRate = parseFloat(upsFRQuote[j].Rate);
    	    			newRate = newRate + rushFee;
    	    			groundRate = getOverrideFee(overrideCost, newRate);
    	    			response.isError = false;
    	    			break;
    	    		} 		    		
    	    	}    				
    		}
    		
    		if (smID == '009-1' || smID == '009-2'){   			
    			if (serviceCode != null && serviceCode != ''){    			   			
        			// USPS
        			if (serviceCode == 'USPS'){   
        				let serviceNames = serviceName.split('|');
        				if(uspsFRQuote != null && uspsFRQuote.length > 0){   				
            				// Local Rates
            				for (let k = 0; k < uspsFRQuote.length; k++) { 
            					for (let j = 0; j < serviceNames.length; j++){
            						if(serviceNames[j] == uspsFRQuote[k].Name){
                		    			let newRate = parseFloat(uspsFRQuote[k].Rate);
                		    			newRate = newRate + rushFee;
                		    			flatRate = getOverrideFee(overrideCost, newRate);
                		    			response.isError = false;
                		    			break;
                		    		} 		
            					}  
            					if (flatRate > 0) break;
            		    	} // End of Quote Mapping
        				} //End of quote check				
        			} //End of service code mapping			
        		} //End of service code check
        		if (flatRate > 0){      			
        			flatRate = flatRate + groundRate;
        			response.newRates.push({"Id":params.applicableShippingMethods[i].ID,"Rate":flatRate});
        			response.applicableShippingMethods.push(params.applicableShippingMethods[i]);
        			session.custom.flatRate = flatRate;
        			break;
        		}
    		}
    	}	// End of applicable shipping method for loop
	} // End of flat rate eligibility check
}

function getOverrideFee(overrideCost, currentRate){
	let fee = currentRate;
	if(overrideCost != null && overrideCost !== undefined && !empty(overrideCost)){ 
		fee = currentRate + currentRate * parseFloat(overrideCost);
	}
	return fee;
}

function populateErrorMessage(response, errors){
	var errorMsg = '';
	if(errors.length > 0){
		for (let i = 0; i < errors.length; i++) { 			
			if(errors[i].Code == '110601'){
				errorMsg = errorMsg + "UPS Restriction: The package weight cannot exceed 150 pounds. ";
			}else if(errors[i].Code == '-2147219499'){
				errorMsg = errorMsg + "USPS Restriction: The package weight cannot exceed 70 pounds. ";
			}else{
				errorMsg = errorMsg + errors[i].Code + ', ' + errors[i].Message;
			}			
		}			
	}
	response.errorMessage = errorMsg;
}

function applyRate(params) {
	try{
		var cart = CartModel.get();
		// setting attribute to ignore BM Shipping rate.
		Transaction.wrap(function () { 
			cart.object.custom.isShippingMethodFromBM = false;
        });	
		
		Transaction.wrap(function () { 
			cart.calculate();
        });
		session.custom.selectedShippingRate = null;		
		
		params = populateProdInfo(params);		
		if (params == null) return;
		
		let serviceCode, serviceId, serviceName, overrideCost = 0.0, rate = 0.0, rateList, method, rushFee;
		
	    for (let i = 0; i < params.applicableShippingMethods.length; i++) {
	    	if (params.applicableShippingMethods[i].ID.equals(params.shippingMethodID)){
	    		serviceCode = params.applicableShippingMethods[i].custom.serviceCode;
	    		serviceId = params.applicableShippingMethods[i].custom.serviceId;
	    		serviceName = params.applicableShippingMethods[i].custom.serviceName;
	    		rushFee = params.applicableShippingMethods[i].custom.rushFee;
	    		overrideCost = params.applicableShippingMethods[i].custom.overrideCost;
	    		method = params.applicableShippingMethods[i];
	    		break;
	    	}
		}
	    
	    if(params.newRates != null && params.newRates.length > 0){	    	
	    	for (let a = 0; a < params.newRates.length; a++) {
	    		if (params.shippingMethodID == params.newRates[a].Id){
	    			rate = params.newRates[a].Rate;
	    			break;
	    		}
	    	}	    
	    }else if(params.shippingMethodID == '009-1' || params.shippingMethodID == '009-2'){
	    	if (session.custom.flatRate != null ) rate = session.custom.flatRate;
	    }else{
	    	if (serviceCode == 'CUSTOM'){
				rateList = custom.GetQuote(params);
				for (let f = 0; f < rateList.length; f++) {  		
		    		if(rateList[f].Code == serviceId){
		    			rate = parseFloat(rateList[f].Rate);
		    			rate = rate + parseFloat(rushFee);
		    			break;
		    		}   
				}	
			}else if (serviceCode == 'UPS'){
				rateList = params.address.countryCode.toUpperCase() == 'US' ? cloud_ups.GetQuote(params) : ups.GetQuote(params);				
				for (let f = 0; f < rateList.length; f++) {  		
		    		if(rateList[f].Code == serviceId){
		    			rate = parseFloat(rateList[f].Rate);
		    			rate = rate + parseFloat(rushFee);
		    			break;
		    		}   
				}	
			}else if(serviceCode == 'USPS'){
				let serviceNames = serviceName.split('|');
				let isSMFound = false;
				rateList = usps.GetQuote(params);
				for (let f = 0; f < rateList.length; f++) { 
					for (let j = 0; j < serviceNames.length; j++){
						if(serviceNames[j] == rateList[f].Name){
			    			rate = parseFloat(rateList[f].Rate);
			    			rate = rate + parseFloat(rushFee);
			    			isSMFound = true;
			    			break;
						} 
					}
					if(isSMFound) break;
				}
				
				isSMFound = false;
				rateList = usps.GetIntQuote(params);
				for (let f = 0; f < rateList.length; f++) {  		
					for (let j = 0; j < serviceNames.length; j++){
    					if(serviceNames[j] == rateList[f].Name){
			    			rate = parseFloat(rateList[f].Rate);
			    			rate = rate + parseFloat(rushFee);
			    			isSMFound = true;
			    			break;
    					} 
					}
					if(isSMFound) break;
				}												
			}else{
				return;
			}
	    	rate = getOverrideFee(overrideCost, rate);
	    }
	    			        
        let shipmentID = cart.getDefaultShipment().getID();
        let lineItems = cart.object.getShipment(shipmentID).shippingLineItems; 
   
		if(rate > 0.0){
			session.custom.selectedShippingRate = rate;			
			Transaction.wrap(function () { 
				cart.object.custom.isShippingMethodFromBM = true;
            });				
		}
		
        var newRate = new dw.value.Money(rate, cart.object.currencyCode);
        
        for (let i = 0; i < lineItems.length; i++) {            
            Transaction.wrap(function () { 
                var lineitem = lineItems[i];
                lineitem.setPriceValue(newRate.value);
            });
        }		
	}catch(e){
		var error = e;
		logger.getLogger("ShippingCarrier", "ShippingCarrier").error("ShippingCarrier.js-applyRate() : " + error.toString());
	}
}

function populateProdInfo(params){
	let cart = CartModel.get(), weight = 0.0, height = 0.0, width = 0.0, lenght = 0.0, girth = 0.0;	
	let itemWeightArray = [], upsWeight = 0.0, uspsWeight = 0.0, upsWeightArray = [], uspsWeightArray = [], ignoreUSPS = false, isUps = false, isUsps = false;
	let frCount = 0, freeShipCount = 0, upsFRWeight = 0.0, uspsFRWeight = 0.0, flatRateWeightArray = [], nonFlatRateWeightArray = [];
	let isFlatRateItemExists = false, isFRUps = false, isFRUsps = false, isOnlyFlatRateItems = false, suppressShippingFreeCheck = false;

	if (cart && !empty(cart.object) && cart.object.productLineItems != null && cart.object.productLineItems.length > 0){
		for (let pl = 0; pl < cart.object.productLineItems.length; pl++) {
			var productLine = cart.object.productLineItems[pl];			
				// get flag for faltRateItem
				if ('ShippingFlatRateEligible' in productLine.product.custom && !empty(productLine.product.custom.ShippingFlatRateEligible) &&  productLine.product.custom.ShippingFlatRateEligible){
					isFlatRateItemExists = true;
					frCount = frCount + 1;
				}
				// get flag for ShippingFreeItem
				if ('ShippingFree' in productLine.product.custom && !empty(productLine.product.custom.ShippingFree) &&  productLine.product.custom.ShippingFree){
					freeShipCount = freeShipCount + 1;
				}
		}
		if (frCount == cart.object.productLineItems.length) isOnlyFlatRateItems = true;
		if (freeShipCount == cart.object.productLineItems.length) suppressShippingFreeCheck = true;
		if (params.address.countryCode.toUpperCase() != 'US') suppressShippingFreeCheck = true;
		
		if(!suppressShippingFreeCheck && params.address.countryCode.toUpperCase() == 'US'){
	    	var notAllowedStates = dw.system.Site.getCurrent().getCustomPreferenceValue('SCS_FreeShipNotAllowedUSStateCds');	    	   		  		   		
			for (let nas = 0; nas < notAllowedStates.length; nas++) {
				if(suppressShippingFreeCheck) break;
		        let naStateCd = notAllowedStates[nas];
		        if(params.address.stateCode.toUpperCase() == naStateCd) suppressShippingFreeCheck = true;    	        
		    }
		}
		
		for (let pl = 0; pl < cart.object.productLineItems.length; pl++) {  
			var productLine = cart.object.productLineItems[pl];
			var isFaltRateItem = false;
			let prodWeight ;
			
			if(!empty(productLine) && !empty(productLine.product) && 'ShipWeightOverride' in  productLine.product.custom && productLine.product.custom.ShipWeightOverride != null && productLine.product.custom.ShipWeightOverride > 0 ){
				prodWeight = productLine.product.custom.ShipWeightOverride;
			}else if (!empty(productLine) && !empty(productLine.product) && productLine.product.custom.ShippingWeight != null){
				prodWeight = productLine.product.custom.ShippingWeight;
			}
			
			if(prodWeight){
				if(!suppressShippingFreeCheck){				
					//If cart has more than one item and one with promotion and another without then ignore weight for the free shipping
					if (!empty(productLine.product.custom.ShippingFree) && productLine.product.custom.ShippingFree){
						continue;
					}															
				}				
				// get flag for faltRateItem
				if (!empty(productLine.product.custom.ShippingFlatRateEligible) &&  productLine.product.custom.ShippingFlatRateEligible){
					isFaltRateItem = true;
				}else{
					isFaltRateItem = false;
				}
				
				prodWeight = parseFloat(prodWeight).toFixed(2);
				prodWeight = parseFloat(prodWeight);
				
				// if single item weight exceeds to 150 then not eligible for UPS and USPS.
				if(prodWeight > 150){
					weight = prodWeight;
					uspsWeightArray = [];
					upsWeightArray = [];
					flatRateWeightArray = [];
					nonFlatRateWeightArray = [];
					isUps = false;
					isUsps = false;
					break;
				}
				
				// if single item weight exceeds to 70 but below 150 then not eligible for USPS
				if(prodWeight > 70){
					uspsWeightArray = [];
					flatRateWeightArray = [];
					nonFlatRateWeightArray = [];
					uspsWeightArray.push(prodWeight);
					isUsps = true;
					ignoreUSPS = true;
				}
				
				for (let ql = 0; ql < productLine.quantity.value; ql++) { 
					// UPS					
					if(upsWeight + prodWeight > 150){
						let isMerged = false;
						for (let wa = 0; wa < upsWeightArray.length; wa++) { 
							let tempCalcWeight = upsWeightArray[wa] + upsWeight;
							if(tempCalcWeight <= 150){
								upsWeightArray[wa] = tempCalcWeight;
								isMerged = true
							}							 
						}
						if(!isMerged) upsWeightArray.push(upsWeight);
						upsWeight = prodWeight;
					}else{
						upsWeight = upsWeight + prodWeight;
					}
					
					// USPS
					if (!ignoreUSPS){
						if(uspsWeight + prodWeight > 70){
							let isMerged = false;
							for (let wa = 0; wa < uspsWeightArray.length; wa++) { 
								let tempCalcWeight = uspsWeightArray[wa] + uspsWeight;
								if(tempCalcWeight <= 70){
									uspsWeightArray[wa] = tempCalcWeight;
									isMerged = true
								}							 
							}
							if(!isMerged) uspsWeightArray.push(uspsWeight);
							uspsWeight = prodWeight;
						}else{
							uspsWeight = uspsWeight + prodWeight;
						}
					}					
				}			
				
				if(isFlatRateItemExists){					
					for (let ql = 0; ql < productLine.quantity.value; ql++) { 
						if(isFaltRateItem){
							// USPS flat rate weight
							if (!ignoreUSPS){
								if(uspsFRWeight + prodWeight > 70){
									let isFlatRateMerged = false;
									for (let wa = 0; wa < flatRateWeightArray.length; wa++) { 
										let tempCalcWeight = flatRateWeightArray[wa] + uspsFRWeight;
										if(tempCalcWeight <= 70){
											flatRateWeightArray[wa] = tempCalcWeight;
											isFlatRateMerged = true
										}							 
									}
									if(!isFlatRateMerged) flatRateWeightArray.push(uspsWeight);
									uspsFRWeight = prodWeight;
								}else{
									uspsFRWeight = uspsFRWeight + prodWeight;
								}
								isFRUsps =  true;
							}			
						}else{ 
							// UPS flat rate weight				
							if(upsFRWeight + prodWeight > 150){
								let  isFlatRateMerged = false;
								for (let wa = 0; wa < nonFlatRateWeightArray.length; wa++) { 
									let tempCalcWeight = nonFlatRateWeightArray[wa] + upsFRWeight;
									if(tempCalcWeight <= 150){
										nonFlatRateWeightArray[wa] = tempCalcWeight;
										isFlatRateMerged = true
									}							 
								}
								if(!isFlatRateMerged) nonFlatRateWeightArray.push(upsFRWeight);																			
								upsFRWeight = prodWeight;
							}else{
								upsFRWeight = upsFRWeight + prodWeight;
							}
							isFRUps = true;									
						}						
					}			
				}			
				
				let prodTotalWeight = prodWeight * productLine.quantity.value;
				prodTotalWeight = parseFloat(prodTotalWeight).toFixed(2);
				prodTotalWeight = parseFloat(prodTotalWeight);
				
				itemWeightArray.push(prodTotalWeight);
				
				weight = weight + prodTotalWeight;
				//height = productLine.product.custom.height;
				//width = productLine.product.custom.width;
				//length = productLine.product.custom.length;
				//girth =  productLine.product.custom.girth;
			}		
		}		
		if(upsWeightArray.length > 0){
			upsWeightArray.push(upsWeight);
		}
		if(uspsWeightArray.length > 0 && !ignoreUSPS){
			uspsWeightArray.push(uspsWeight);
		}
		if(upsFRWeight > 0){
			nonFlatRateWeightArray.push(upsFRWeight);
		}
		if(uspsFRWeight > 0 && !ignoreUSPS){
			flatRateWeightArray.push(uspsFRWeight);
		}
	}

	var upsKeyValues = {}, uspsKeyValues = {};
	var upsFRKeyValues = {}, uspsFRKeyValues = {};
	
	if(upsWeightArray.length > 0){
		isUps = true;	
		for (let r = 0; r < upsWeightArray.length; r++) { 	
			var tempUpsRate = upsWeightArray[r];		
			if(upsKeyValues[tempUpsRate] === undefined){
				upsKeyValues[tempUpsRate] = 1;
			}else{
				upsKeyValues[tempUpsRate] = upsKeyValues[tempUpsRate] + 1;
			}		
		}
	}

	if(uspsWeightArray.length > 0){
		isUsps = true;
		for (let r = 0; r < uspsWeightArray.length; r++) { 		
			var tempUSPSRate = uspsWeightArray[r];		
			if(uspsKeyValues[tempUSPSRate] === undefined){
				uspsKeyValues[tempUSPSRate] = 1;
			}else{
				uspsKeyValues[tempUSPSRate] = uspsKeyValues[tempUSPSRate] + 1;
			}		
		}
	}
	
	if(nonFlatRateWeightArray.length > 0){	
		for (let r = 0; r < nonFlatRateWeightArray.length; r++) { 	
			var tempFRUpsRate = nonFlatRateWeightArray[r];		
			if(upsFRKeyValues[tempFRUpsRate] === undefined){
				upsFRKeyValues[tempFRUpsRate] = 1;
			}else{
				upsFRKeyValues[tempFRUpsRate] = upsFRKeyValues[tempFRUpsRate] + 1;
			}		
		}
	}

	if(flatRateWeightArray.length > 0){
		for (let r = 0; r < flatRateWeightArray.length; r++) { 		
			var tempFRUSPSRate = flatRateWeightArray[r];		
			if(uspsFRKeyValues[tempFRUSPSRate] === undefined){
				uspsFRKeyValues[tempFRUSPSRate] = 1;
			}else{
				uspsFRKeyValues[tempFRUSPSRate] = uspsFRKeyValues[tempFRUSPSRate] + 1;
			}		
		}
	}
	// Adding additional data's to get rates
	params.itemWeights = itemWeightArray;
	params.shippingWeight = weight;
	params.upsWeight = upsKeyValues;
	params.uspsWeight = uspsKeyValues;
	params.upsFlatRateWeight = upsFRKeyValues;
	params.uspsFlatRateWeight = uspsFRKeyValues;
	params.height = height;
	params.width = width;
	params.length = lenght;
	params.girth = girth;
	params.hasUPSArr = isUps;
	params.hasUSPSArr = isUsps;
	params.hasFRUPSArr = isFRUps;
	params.hasFRUSPSArr = isFRUsps;
	params.isFlatRateEligible = isFlatRateItemExists;
	params.isOnlyFlatRateItems = isOnlyFlatRateItems;
	params.basketData = cart.object;
	return params;
}

/**
 * getEstimate.
 */
function getEstimate() {	
	let addressParam = {
			postalcode : session.forms.shippingestimator.shippingestimate.zipcode.value
	}
	
	var addresses = require('int_tejas_google/cartridge/scripts/address/address').GetAddresses(addressParam);
	
	if(addresses == null || empty(addresses.postal_code) || addresses.postal_code == null){
		session.forms.shippingestimator.clearFormElement();	
		app.getController('Cart').Show();
		return;
	}
	let TransientAddress = app.getModel('TransientAddress');  
    let address = new TransientAddress();	        		
	address.countryCode = addresses.country;
	address.postalCode = addresses.postal_code; 
	address.stateCode = addresses.administrative_area_level_1;
	address.city = addresses.locality; 
	
	session.forms.shippingestimator.shippingestimate.countrycode.value = addresses.country;
	session.forms.shippingestimator.shippingestimate.statecode.value = addresses.administrative_area_level_1;
	session.forms.shippingestimator.shippingestimate.city.value = addresses.locality; 
	
	var cart = CartModel.get();
	
    let params = {
    		"excludeCSCShippingMethods" : true,
        	"address": address,
        	"applicableShippingMethods": cart.getApplicableShippingMethods(address)
	}; 
      
    var response = start(params);
	var newRates = response.newRates;
	var applicableShippingMethods = response.applicableShippingMethods;
    	    	
	var lowPriceShipping = getLowPriceShipping(newRates, applicableShippingMethods);
    	    	
	let shipmentID = cart.getDefaultShipment().getID();
	let lineItems = cart.object.getShipment(shipmentID).shippingLineItems; 
	
	if(lowPriceShipping.Rate){
		var newRate = new dw.value.Money(lowPriceShipping.Rate, cart.object.currencyCode);
		
		Transaction.wrap(function () {
	        cart.updateShipmentShippingMethod(shipmentID, lowPriceShipping.ShippingMethodID, null, applicableShippingMethods);
	        cart.calculate();
		});
	    			
	    for (let i = 0; i < lineItems.length; i++) {            
	        Transaction.wrap(function () { 
	            var lineitem = lineItems[i];
	            lineitem.setPriceValue(newRate.value);
	        });
	    }
	}else{
		// Reset Shipping 
		Transaction.wrap(function () {
			var defaultShipment = cart.getDefaultShipment();	        
	        defaultShipment.setShippingMethod(null);
		});
	}
	app.getController('Cart').Show();
}

function getLowPriceShipping(newRates, applicableShippingMethods){
	var lowPriecShipping = {}, shippingMethodID = '', lowestPrice = -1;

	if (applicableShippingMethods != null && applicableShippingMethods.length > 0 ){
	    for (let i = 0; i < applicableShippingMethods.length; i++) {
	    	
	    	var finalRate = getRate(applicableShippingMethods[i], newRates);
	    	
	    	if (session.custom.selectedShippingMethodId == applicableShippingMethods[i].ID){
	    		lowPriecShipping.ShippingMethodID = applicableShippingMethods[i].ID
	    		lowPriecShipping.Rate = finalRate;
	    		break;
	    	}	
	    	let price = parseFloat(finalRate);
	    	if(lowestPrice == -1 || lowestPrice > price) {
	    		lowestPrice = price;
	    		lowPriecShipping.ShippingMethodID = applicableShippingMethods[i].ID;
	    		lowPriecShipping.Rate = finalRate;
	    	}
	    }
	}
		
  return lowPriecShipping;
}

function getRate(method, newRates){
	let rate = 0.0;
	if (newRates != null && newRates.length > 0 ){
		for (let lpm = 0; lpm < newRates.length; lpm++) {
			if(method.ID == newRates[lpm].Id){
				rate =  newRates[lpm].Rate;
				break;
			}			
		}
		if(rate == 0.0){
			rate = getRateFromBM(method);
		}		
	}else{
		rate = getRateFromBM(method);
	}
	 return rate;
}

function getRateFromBM(shippingMethod){
	var cart = app.getModel('Cart').get();
	var shipment = cart.getDefaultShipment();
	var model = ShippingMgr.getShipmentShippingModel(shipment);    	
	let shippingCost =  model.getShippingCost(shippingMethod);
	return parseFloat(shippingCost.getAmount().value).toFixed(2);
}

exports.Start = guard.ensure(['https'], start);

exports.ApplyRate = guard.ensure(['https'], applyRate);

exports.Estimate = guard.ensure(['https'], getEstimate);
