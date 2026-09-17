# Famille de produits structurés « Autocall Yeti Phoenix »

## Synthèse
Cette famille de produits structurés regroupe des instruments financiers de type "Autocall" (à rappel automatique) 
présentant un risque en capital à l’échéance, tout en intégrant des mécanismes de protection sous conditions 
(par exemple, des barrières activables et des options de vente "Down-and-In" in-fine).

## Liste des Variantes (Payoffs)
La famille "Yeti Phoenix Autocall" comprend les déclinaisons (variantes) spécifiques suivantes :

- Phoenix Asian PDI (AutoCall_Phoenix_Asian_PDI / ID : 10449)
- Vanilla Autocall (AutoCall_Vanilla / ID : 10488)
- Call On Custom Basket (Autocall_CallOnCustomizedBasket_Copy / ID : 10627)
- Multi Range-Accrual (AutoCall_Range_Accrual_Multi / ID : 10740)
- Capped/Floored Asian (AutoCall_Asian_WithCapFloor / ID : 10401)
- Strategies (AutoCall_Strategies / ID : 10702)
- Strategies Digits (AutoCall_Strategies_Digits2 / ID : 10756)
- Target Coupon Redemption (AutoCall_TargetCouponRedemption / ID : 10743)
- Yeti Phoenix Strategies (AutoCall_Yeti_Phoenix_Strategies / ID : 10762)

## Liste des Caractéristiques
Le document distingue plusieurs variables d'observation et propriétés structurelles clés :

- L'événement Barrière d'Autocall (Autocall Barrier event) : Événements déclencheurs déterminant si la performance du sous-jacent atteint la barrière de rappel automatique pour la première fois.
- L'événement Barrière Yeti (Yeti Barrier Event) : Versement d'un coupon "Yeti" lorsqu'une barrière Yeti est franchie, tant que la barrière d'Autocall n'a pas été atteinte.
- La caractéristique Yeti Bonus Equity : Des coupons bonus garantis tant que l'option n'a pas fait l'objet d'un rappel anticipé par le passé.
- L'événement Barrière Knock-In discret / Option Down-and-In in-fine : Une barrière discrète observée à l'échéance si aucun événement d'Autocall n'est survenu.
- L'effet (Yeti) Zenith : Remplacement du coupon à mémoire (memory coupon) par une formule de coupon Zenith sur mesure utilisant un levier (gearing), un cap, un floor et un strike.
- La Barrière Star-Effect (Star-Effect Barrier) : Désactivation de l'événement de knock-in si la performance dépasse la barrière "Star-Effect".

## Caractéristiques par Variantes
Chaque variante applique ces mécanismes de manière spécifique :

- Phoenix Asian PDI : Structure auto-callable adossée à un panier de performances asiatiques, avec une option de vente Down-and-In (PDI) in-fine. Elle inclut des coupons de type Phoenix payés si un événement d'autocall survient.
- Vanilla : Structure auto-callable standard basée sur la performance d'une seule action, comprenant une option Down-and-In in-fine (option d'achat ou de vente classique sous condition que le sous-jacent franchisse un certain niveau de barrière).
- Call on Custom Basket : Produit basé sur la moins bonne performance ("worst-of") d'un panier personnalisé, caractérisé par une option digitale in-fine et un taux garanti.
- Multi Range-Accrual : Structure auto-callable standard sur des performances de type worst-of, rainbow ou panier, avec une option knock-in discrète in-fine et des coupons de type « range-accrual » proportionnels au nombre de jours passés dans un corridor cible.
- Capped/Floored Asian : Option asiatique avec barrière knock-in discrète in-fine, intégrant des plafonds (caps) et planchers (floors) globaux et individuels, adossée à un panier.
- Strategies : Structure auto-callable sur performances "worst-of" avec une clause de mémoire (memory) payée si la pire performance dépasse un niveau de barrière Yeti, des coupons Phoenix en cas d'autocall, et un Put Down-and-In sur un panier de performances asiatiques.
- Strategies Digits : Variante similaire à "Strategies" pour sa clause in-fine, mais utilisant des barrières digitalisées et un lissage numérique à double corridor (dual multi-corridor digit smoothing).
- Target Coupon Redemption : Structure auto-callable sur performance rainbow avec option Down-and-In in-fine. Le remboursement anticipé se déclenche automatiquement lorsque la somme des coupons Yeti distribués dépasse le niveau de la barrière d'autocall.
- Yeti Phoenix Strategies : Structure auto-callable basée sur une fonction mathématique des performances d'un panier sous-jacent (Strategies), combinant à la fois des coupons Yeti à mémoire et des coupons Phoenix.

## Caractéristiques Communes
Certains paramètres de sécurité, modélisations et structures contractuelles sont standardisés et identiques pour l'ensemble des payoffs de cette famille :
- La maturité
- De manière optionnelle, la date de départ différé (Forward Start)
- Le sous-jacent ou un panier de sous-jacents dans le cas multi-sous-jacent
- L'échancier de dates de rappel, sous forme de fréquence. On peut optionnellement préciser une période initiale où il n'y a pas de rappel (NC : Non Call) 
- L'échancier de dates de paiement du coupon
- Optionnellement, Le jeu de dates Asian In Constitué de $N$ dates d'observation à partir du début du produit, et qui servent à calculer la moyenne initiale (Asian In)
